import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { AppError, safeErrorForLog } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";
import { getStorageConfig, type StorageConfig } from "./config";
import { getStorageProvider } from "./factory";
import { assertKeyInOrg, buildBlobKey, isStorageCategory, orgPrefix, sanitizeFileName, type StorageCategory } from "./keys";
import { MAGIC_HEAD_BYTES, matchesMagic } from "./magic";
import { DEFAULT_SIGNED_URL_TTL_SECONDS, MAX_SIGNED_URL_TTL_SECONDS, type StorageProvider } from "./provider";

/**
 * SPEC-050 — operacoes de arquivo. `orgId` (e `userId`) vem SEMPRE da sessao (route handlers), nunca do
 * cliente; todo acesso a metadado passa por `scopedPrisma(orgId)` e toda chave e revalidada contra
 * `orgs/{orgId}/`. Org errada => `not_found` (nunca revela que o arquivo existe em outra org).
 */
export interface StoredFileView {
  id: string;
  category: StorageCategory;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
}

interface Deps {
  provider?: StorageProvider;
  config?: StorageConfig;
}

const NOT_FOUND = () => new AppError({ code: "not_found", userMessage: "Arquivo não encontrado.", status: 404 });
const invalid = (msg: string, status = 400) => new AppError({ code: "validation", userMessage: msg, status });

function view(f: { id: string; category: string; originalName: string; mimeType: string; sizeBytes: number; createdAt: Date }): StoredFileView {
  return { id: f.id, category: f.category as StorageCategory, originalName: f.originalName, mimeType: f.mimeType, sizeBytes: f.sizeBytes, createdAt: f.createdAt };
}

/** Normaliza o MIME declarado (sem parametros, minusculo). */
export function normalizeMime(raw: string): string {
  return raw.split(";")[0].trim().toLowerCase();
}

export function assertUploadAllowed(mime: string, declaredSize: number | null, cfg: StorageConfig): void {
  if (!cfg.allowedMime.includes(mime)) throw invalid("Tipo de arquivo não permitido.", 415);
  if (declaredSize !== null && declaredSize > cfg.maxFileBytes) throw invalid(`Arquivo maior que o limite de ${cfg.maxFileBytes} bytes.`, 413);
}

/**
 * Envolve o stream de entrada: valida magic bytes no primeiro bloco, conta bytes, aborta ao passar do limite
 * e calcula o sha256 incrementalmente.
 */
function guard(source: AsyncIterable<Uint8Array>, mime: string, max: number, out: { size: number; hash: ReturnType<typeof createHash> }): Readable {
  async function* gen(): AsyncGenerator<Buffer> {
    let head: Buffer[] = [];
    let headLen = 0;
    let checked = false;
    const emit = (c: Buffer) => {
      out.size += c.length;
      if (out.size > max) throw invalid(`Arquivo maior que o limite de ${max} bytes.`, 413);
      out.hash.update(c);
      return c;
    };
    for await (const raw of source) {
      const chunk = Buffer.from(raw);
      if (checked) {
        yield emit(chunk);
        continue;
      }
      head.push(chunk);
      headLen += chunk.length;
      if (headLen < MAGIC_HEAD_BYTES) continue;
      const all = Buffer.concat(head);
      if (!matchesMagic(mime, all)) throw invalid("O conteúdo do arquivo não corresponde ao tipo informado.", 415);
      checked = true;
      head = [];
      yield emit(all);
    }
    if (!checked) {
      const all = Buffer.concat(head);
      if (!matchesMagic(mime, all)) throw invalid(all.length === 0 ? "Arquivo vazio." : "O conteúdo do arquivo não corresponde ao tipo informado.", 415);
      yield emit(all);
    }
  }
  return Readable.from(gen());
}

export async function uploadFile(
  ctx: { orgId: string; userId: string },
  input: { category: string; fileName: string; contentType: string; declaredSize?: number | null; body: AsyncIterable<Uint8Array> },
  deps: Deps = {},
): Promise<StoredFileView> {
  const cfg = deps.config ?? getStorageConfig();
  const provider = deps.provider ?? getStorageProvider();
  if (!isStorageCategory(input.category)) throw invalid("Categoria inválida.");
  const mime = normalizeMime(input.contentType);
  assertUploadAllowed(mime, input.declaredSize ?? null, cfg);

  const id = randomUUID();
  const originalName = sanitizeFileName(input.fileName);
  const key = buildBlobKey(ctx.orgId, input.category, originalName, id);
  assertKeyInOrg(key, ctx.orgId);

  const acc = { size: 0, hash: createHash("sha256") };
  try {
    await provider.put(key, guard(input.body, mime, cfg.maxFileBytes, acc), { contentType: mime });
  } catch (e) {
    await provider.delete(key).catch(() => {});
    throw e;
  }
  try {
    const row = await scopedPrisma(ctx.orgId).storedFile.create({
      data: { id, category: input.category, blobKey: key, originalName, mimeType: mime, sizeBytes: acc.size, sha256: acc.hash.digest("hex"), uploadedByUserId: ctx.userId },
    });
    return view(row);
  } catch (e) {
    await provider.delete(key).catch(() => {});
    throw e;
  }
}

export async function listFiles(
  orgId: string,
  opts: { category?: string; cursor?: string | null; limit?: number } = {},
): Promise<{ items: StoredFileView[]; nextCursor: string | null }> {
  if (opts.category !== undefined && !isStorageCategory(opts.category)) throw invalid("Categoria inválida.");
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const rows = await scopedPrisma(orgId).storedFile.findMany({
    where: { deletedAt: null, ...(opts.category ? { category: opts.category } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, limit);
  return { items: page.map(view), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
}

async function findLive(orgId: string, id: string) {
  const f = await scopedPrisma(orgId).storedFile.findFirst({ where: { id, deletedAt: null } });
  if (!f) throw NOT_FOUND();
  assertKeyInOrg(f.blobKey, orgId);
  return f as { id: string; blobKey: string; originalName: string; mimeType: string; sizeBytes: number; category: string; createdAt: Date };
}

function clampTtl(ttl?: number): number {
  return Math.min(Math.max(Math.floor(ttl ?? DEFAULT_SIGNED_URL_TTL_SECONDS), 1), MAX_SIGNED_URL_TTL_SECONDS);
}

/** URL SAS de leitura (curta) APOS checar que o arquivo e da org. */
export async function getFileUrl(orgId: string, id: string, opts: { ttlSeconds?: number } = {}, deps: Deps = {}): Promise<{ url: string; expiresInSeconds: number }> {
  const f = await findLive(orgId, id);
  const ttlSeconds = clampTtl(opts.ttlSeconds);
  const url = await (deps.provider ?? getStorageProvider()).getReadUrl(f.blobKey, { ttlSeconds, fileName: f.originalName });
  return { url, expiresInSeconds: ttlSeconds };
}

/** URL SAS de escrita (`getUploadUrl` da interface): reservada para upload direto futuro, sem UI/rota (D-050-4). */
export async function getUploadUrl(
  ctx: { orgId: string },
  input: { category: string; fileName: string; contentType: string; ttlSeconds?: number },
  deps: Deps = {},
): Promise<{ key: string; url: string }> {
  const cfg = deps.config ?? getStorageConfig();
  if (!isStorageCategory(input.category)) throw invalid("Categoria inválida.");
  const mime = normalizeMime(input.contentType);
  assertUploadAllowed(mime, null, cfg);
  const key = buildBlobKey(ctx.orgId, input.category, input.fileName);
  const url = await (deps.provider ?? getStorageProvider()).getUploadUrl(key, { ttlSeconds: clampTtl(input.ttlSeconds), contentType: mime });
  return { key, url };
}

/** Soft delete + remocao fisica imediata do blob (D-050-8). Falha no blob nao desfaz o soft delete (reconciliar depois). */
export async function deleteFile(orgId: string, id: string, deps: Deps = {}): Promise<void> {
  const f = await findLive(orgId, id);
  await scopedPrisma(orgId).storedFile.update({ where: { id: f.id }, data: { deletedAt: new Date() } });
  try {
    await (deps.provider ?? getStorageProvider()).delete(f.blobKey);
  } catch (e) {
    console.error("[storage] falha ao remover blob (reconciliar):", safeErrorForLog(e));
  }
}

/**
 * Reconciliacao/limpeza de orfaos de UMA org: (1) blobs de arquivos ja soft-deleted; (2) blobs sem linha de
 * metadado, mais antigos que `graceMs` (evita apagar upload em andamento). Retorna quantos blobs removeu.
 */
export async function reconcileOrgBlobs(orgId: string, opts: { graceMs?: number; now?: Date } = {}, deps: Deps = {}): Promise<number> {
  const provider = deps.provider ?? getStorageProvider();
  const grace = opts.graceMs ?? 3600_000;
  const now = (opts.now ?? new Date()).getTime();
  const rows = await scopedPrisma(orgId).storedFile.findMany({ select: { blobKey: true, deletedAt: true } });
  const live = new Set(rows.filter((r: { deletedAt: Date | null }) => !r.deletedAt).map((r: { blobKey: string }) => r.blobKey));
  let removed = 0;
  for (const o of await provider.list(orgPrefix(orgId))) {
    assertKeyInOrg(o.key, orgId);
    if (live.has(o.key) || now - o.lastModified.getTime() < grace) continue;
    await provider.delete(o.key);
    removed++;
  }
  return removed;
}

/** Purga (SPEC-033, D-33-4): remove TODOS os blobs `orgs/{orgId}/` e marca o metadado como removido. */
export async function purgeOrgFiles(orgId: string, deps: Deps = {}): Promise<number> {
  const provider = deps.provider ?? getStorageProvider();
  let removed = 0;
  for (const o of await provider.list(orgPrefix(orgId))) {
    assertKeyInOrg(o.key, orgId);
    await provider.delete(o.key);
    removed++;
  }
  await scopedPrisma(orgId).storedFile.updateMany({ where: { deletedAt: null }, data: { deletedAt: new Date() } });
  return removed;
}

/** A org tem algum metadado de arquivo (inclusive soft-deleted)? Evita exigir storage configurado na purga de orgs sem arquivos. */
export async function orgHasFiles(orgId: string): Promise<boolean> {
  return (await prisma.storedFile.count({ where: { orgId } })) > 0;
}
