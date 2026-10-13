import { Prisma } from "@prisma/client";
import { AppError, safeErrorForLog } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";
import { assertWithinEntitlementLimit } from "@/lib/billing/entitlements";
import { deleteFile, getFileUrl } from "@/lib/storage/service";
import type { StorageConfig } from "@/lib/storage/config";
import type { StorageProvider } from "@/lib/storage/provider";
import { getCreativeConfig, type CreativeConfig } from "./config";
import { getAvatarVideoProvider } from "./factory";
import { estimateDurationSec, moderateScript } from "./moderation";
import type { AvatarVideoProvider } from "./provider";
import { creativeDetailView, creativeView, JOB_SELECT } from "./views";
import type { AvatarsAndVoices, CreativeDetailView, CreativeView, ListCreativesResult } from "./types";

/**
 * SPEC-051 (051a) — regras de negocio dos criativos. `orgId`/`userId` vem SEMPRE da sessao (actions); todo acesso passa por
 * `scopedPrisma(orgId)` (ou por `raw.$transaction` com `orgId` explicito no where). Registro de outra org => `not_found`.
 * Papeis (D-051-3): `owner` e `member` criam/enviam/cancelam/reenviam; excluir exige ser `owner` OU o criador.
 */
export interface Ctx {
  orgId: string;
  userId: string;
}
export interface Deps {
  provider?: AvatarVideoProvider;
  config?: CreativeConfig;
  storage?: { provider?: StorageProvider; config?: StorageConfig };
  now?: Date;
}

const notFound = () => new AppError({ code: "not_found", userMessage: "Criativo não encontrado.", status: 404 });
const conflict = (msg: string) => new AppError({ code: "conflict", userMessage: msg, status: 409 });
const invalid = (msg: string) => new AppError({ code: "validation", userMessage: msg, status: 400 });

export const monthStartUtc = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

const ACTIVE = ["queued", "processing"] as const;

function depsOf(deps: Deps) {
  const config = deps.config ?? getCreativeConfig();
  const provider = deps.provider ?? getAvatarVideoProvider();
  return { config, provider, now: deps.now ?? new Date() };
}

/** Valida roteiro (tamanho/blocklist), duracao, avatar/voz do catalogo e idioma da voz. Devolve a duracao efetiva. */
async function validateContent(
  c: { script: string; language: string; avatarRef: string; voiceRef: string; durationSec?: number | null },
  config: CreativeConfig,
  provider: AvatarVideoProvider,
): Promise<number> {
  const mod = moderateScript(c.script, config);
  if (mod) throw invalid(mod);
  const est = estimateDurationSec(c.script);
  const duration = c.durationSec ?? est;
  if (Math.max(est, duration) > config.maxDurationSec) throw invalid(`A duração do vídeo (aprox. ${Math.max(est, duration)}s) excede o máximo de ${config.maxDurationSec}s.`);
  const [avatars, voices] = await Promise.all([provider.listAvatars(), provider.listVoices()]);
  if (!avatars.some((a) => a.id === c.avatarRef)) throw invalid("Avatar inválido.");
  const voice = voices.find((v) => v.id === c.voiceRef);
  if (!voice) throw invalid("Voz inválida.");
  if (voice.language !== c.language) throw invalid("A voz escolhida não corresponde ao idioma do roteiro.");
  return duration;
}

export async function createCreativeDraft(
  ctx: Ctx,
  input: { title: string; script: string; language: string; avatarRef: string; voiceRef: string; aspectRatio: string; durationSec?: number },
  deps: Deps = {},
): Promise<CreativeView> {
  const { config, provider } = depsOf(deps);
  const durationSec = await validateContent(input, config, provider);
  // SPEC-069b: plano sem criativos (limite 0, ex.: Free) nao cria nem rascunho; com limite > 0 o rascunho e livre (a cota conta no envio).
  await assertWithinEntitlementLimit(prisma, ctx.orgId, "creatives", 0, 1, deps.now ?? new Date());
  const row = await scopedPrisma(ctx.orgId).creative.create({
    data: {
      title: input.title, script: input.script, language: input.language, avatarRef: input.avatarRef, voiceRef: input.voiceRef,
      aspectRatio: input.aspectRatio, durationSec, createdBy: ctx.userId, status: "draft",
    },
  });
  return creativeView(row);
}

async function loadLive(orgId: string, id: string) {
  const c = await scopedPrisma(orgId).creative.findFirst({ where: { id, deletedAt: null }, include: { jobs: { orderBy: { runNo: "desc" }, take: 1, select: JOB_SELECT } } });
  if (!c) throw notFound();
  return c;
}

/**
 * Enfileira uma execucao (novo CreativeJob) para o criativo. Serializado por advisory lock da org (limites sem corrida);
 * transicao por compare-and-set no status (envio duplo / duplo clique nao cria 2 jobs: o 2o ve `queued` e devolve o estado atual).
 */
async function enqueue(ctx: Ctx, id: string, allowedFrom: readonly string[], deps: Deps, mode: "submit" | "retry"): Promise<CreativeView> {
  const { config, provider, now } = depsOf(deps);
  const current = await loadLive(ctx.orgId, id);
  if ((ACTIVE as readonly string[]).includes(current.status)) return creativeView(current); // idempotente: ja em andamento
  if (!allowedFrom.includes(current.status)) {
    throw conflict(current.status === "ready" ? "Este criativo já foi gerado." : mode === "submit" ? "Somente rascunhos podem ser enviados." : "Somente criativos com falha ou cancelados podem ser reenviados.");
  }
  const durationSec = await validateContent(current, config, provider); // reavalia (limites/blocklist podem ter mudado)
  const monthStart = monthStartUtc(now);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"creative-limits:" + ctx.orgId}))`;
      const fresh = await tx.creative.findFirst({ where: { id, orgId: ctx.orgId, deletedAt: null }, select: { status: true, submittedAt: true } });
      if (!fresh) throw notFound();
      if ((ACTIVE as readonly string[]).includes(fresh.status)) return; // outro request venceu
      if (!allowedFrom.includes(fresh.status)) throw conflict("O criativo mudou de estado. Atualize a página.");

      const active = await tx.creative.count({ where: { orgId: ctx.orgId, deletedAt: null, status: { in: [...ACTIVE] } } });
      if (active >= config.maxConcurrentJobsPerOrg) throw conflict(`Limite de ${config.maxConcurrentJobsPerOrg} geração(ões) simultânea(s) atingido. Aguarde uma terminar.`);
      const needsQuota = !fresh.submittedAt || fresh.submittedAt < monthStart;
      const used = await tx.creative.count({ where: { orgId: ctx.orgId, submittedAt: { gte: monthStart } } }); // inclui excluidos (soft delete): excluir nao devolve cota
      // SPEC-069b: limite mensal DO PLANO (0/3/20; sob o advisory lock da org). Reenvio de criativo ja contado no mes nao consome cota, mas plano sem criativos barra.
      await assertWithinEntitlementLimit(tx, ctx.orgId, "creatives", used, needsQuota ? 1 : 0, now);
      if (needsQuota && used >= config.maxPerMonthPerOrg) throw conflict(`Limite mensal de ${config.maxPerMonthPerOrg} criativos atingido.`);

      const last = await tx.creativeJob.findFirst({ where: { creativeId: id, orgId: ctx.orgId }, orderBy: { runNo: "desc" }, select: { runNo: true, providerJobId: true, failureKind: true } });
      const runNo = (last?.runNo ?? 0) + 1;
      // Retry NAO duplica cobranca: falha nossa (timeout/download/storage) reaproveita o job ja criado no provedor.
      const reuse = mode === "retry" && last?.providerJobId && ["timeout", "download", "storage"].includes(last.failureKind ?? "") ? last.providerJobId : null;

      const moved = await tx.creative.updateMany({
        where: { id, orgId: ctx.orgId, deletedAt: null, status: { in: [...allowedFrom] as never[] } },
        data: { status: "queued", error: null, durationSec, ...(needsQuota ? { submittedAt: now } : {}) },
      });
      if (moved.count !== 1) throw conflict("O criativo mudou de estado. Atualize a página.");
      await tx.creativeJob.create({
        data: {
          orgId: ctx.orgId, creativeId: id, runNo, idempotencyKey: `creative:${id}:run:${runNo}`, provider: provider.name,
          providerJobId: reuse, status: "queued", nextRunAt: now, deadlineAt: new Date(now.getTime() + config.jobTimeoutMs),
          costEstimateCents: provider.estimateCostCents(durationSec),
        },
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return creativeView(await loadLive(ctx.orgId, id)); // corrida no runNo/idempotencyKey: o outro request ja enfileirou
    throw e;
  }
  return creativeView(await loadLive(ctx.orgId, id));
}

export const submitCreative = (ctx: Ctx, id: string, deps: Deps = {}) => enqueue(ctx, id, ["draft"], deps, "submit");
export const retryCreative = (ctx: Ctx, id: string, deps: Deps = {}) => enqueue(ctx, id, ["failed", "canceled"], deps, "retry");

export async function listCreatives(orgId: string, opts: { status?: string; q?: string; cursor?: string | null; limit?: number } = {}): Promise<ListCreativesResult> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const rows = await scopedPrisma(orgId).creative.findMany({
    where: { deletedAt: null, ...(opts.status ? { status: opts.status } : {}), ...(opts.q ? { title: { contains: opts.q, mode: "insensitive" } } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: { jobs: { orderBy: { runNo: "desc" }, take: 1, select: JOB_SELECT } },
  });
  const page = rows.slice(0, limit);
  return { items: page.map(creativeView), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
}

export async function getCreative(orgId: string, id: string): Promise<CreativeDetailView> {
  const c = await scopedPrisma(orgId).creative.findFirst({ where: { id, deletedAt: null }, include: { jobs: { orderBy: { runNo: "desc" }, take: 10, select: JOB_SELECT } } });
  if (!c) throw notFound();
  return creativeDetailView(c);
}

/** Cancela (qualquer membro). Cancelar antes de chamar o provedor devolve a cota do mes. */
export async function cancelCreative(ctx: Ctx, id: string, deps: Deps = {}): Promise<CreativeView> {
  const { provider, now } = depsOf(deps);
  const c = await loadLive(ctx.orgId, id);
  if (c.status === "canceled") return creativeView(c); // idempotente
  if (!(ACTIVE as readonly string[]).includes(c.status)) throw conflict("Só é possível cancelar criativos em fila ou em processamento.");
  const providerJobId = await prisma.$transaction(async (tx) => {
    // FOR UPDATE no job ativo (M2): serializa com a confirmacao do runner (`createRemote`, que grava processing + providerJobId).
    // Sem o lock, o cancel lia providerJobId=null, o runner confirmava logo depois e o cancel ainda casava: job cancelado sem
    // `provider.cancel` (orfao cobrado) e cota devolvida indevidamente. Com o lock, ou o cancel le o providerJobId ja gravado
    // (caminho "ja no provedor"), ou o runner espera, perde o CAS (job canceled) e cancela o job remoto por conta propria.
    const rows = await tx.$queryRaw<{ id: string; providerJobId: string | null }[]>`
      SELECT "id", "providerJobId" FROM "CreativeJob"
      WHERE "creativeId" = ${id} AND "orgId" = ${ctx.orgId} AND "status"::text IN ('queued', 'processing')
      ORDER BY "runNo" DESC LIMIT 1 FOR UPDATE`;
    const job = rows[0] ?? null;
    const moved = await tx.creative.updateMany({
      where: { id, orgId: ctx.orgId, status: { in: [...ACTIVE] } },
      data: { status: "canceled", error: null, ...(job && !job.providerJobId ? { submittedAt: null } : {}) },
    });
    if (moved.count !== 1) return undefined;
    if (job) await tx.creativeJob.updateMany({ where: { id: job.id, orgId: ctx.orgId, status: { in: [...ACTIVE] } }, data: { status: "canceled", failureKind: "canceled", errorMessage: "Geração cancelada.", finishedAt: now, lockedAt: null } });
    return job?.providerJobId ?? null;
  });
  if (providerJobId) await provider.cancel?.(providerJobId).catch((e) => console.error("[creatives] cancel no provedor falhou:", safeErrorForLog(e)));
  return creativeView(await loadLive(ctx.orgId, id));
}

/** Exclui: owner da org OU criador. Cancela se ativo, remove o blob (SPEC-050) e faz soft delete (a cota do mes continua contada). */
export async function deleteCreative(ctx: Ctx, id: string, deps: Deps = {}): Promise<void> {
  const c = await loadLive(ctx.orgId, id);
  if (c.createdBy !== ctx.userId) {
    const m = await prisma.membership.findUnique({ where: { userId_orgId: { userId: ctx.userId, orgId: ctx.orgId } }, select: { orgRole: true } });
    if (m?.orgRole !== "owner") throw new AppError({ code: "forbidden", userMessage: "Somente o dono da organização ou quem criou pode excluir este criativo.", status: 403 });
  }
  if ((ACTIVE as readonly string[]).includes(c.status)) await cancelCreative(ctx, id, deps);
  const db = scopedPrisma(ctx.orgId);
  const files = await db.creative.findFirst({ where: { id }, select: { videoFileId: true, thumbnailFileId: true } });
  for (const fileId of [files?.videoFileId, files?.thumbnailFileId]) {
    if (!fileId) continue;
    await deleteFile(ctx.orgId, fileId, deps.storage ?? {}).catch((e) => {
      if (!(e instanceof AppError && e.code === "not_found")) throw e;
    });
  }
  await db.creative.update({ where: { id }, data: { deletedAt: deps.now ?? new Date(), videoFileId: null, thumbnailFileId: null } });
}

export async function getCreativeVideoUrl(orgId: string, id: string, deps: Deps = {}): Promise<{ url: string; expiresInSeconds: number }> {
  const c = await scopedPrisma(orgId).creative.findFirst({ where: { id, deletedAt: null }, select: { status: true, videoFileId: true } });
  if (!c) throw notFound();
  if (c.status !== "ready" || !c.videoFileId) throw conflict("O vídeo deste criativo ainda não está disponível.");
  return getFileUrl(orgId, c.videoFileId, { ttlSeconds: 300 }, deps.storage ?? {});
}

export async function listAvatarsAndVoices(orgId: string, deps: Deps = {}): Promise<AvatarsAndVoices> {
  const { config, provider, now } = depsOf(deps);
  const db = scopedPrisma(orgId);
  const [avatars, voices, usedThisMonth, activeNow] = await Promise.all([
    provider.listAvatars(),
    provider.listVoices(),
    db.creative.count({ where: { submittedAt: { gte: monthStartUtc(now) } } }),
    db.creative.count({ where: { deletedAt: null, status: { in: [...ACTIVE] } } }),
  ]);
  return {
    provider: provider.name, avatars, voices,
    limits: { maxDurationSec: config.maxDurationSec, maxScriptChars: config.maxScriptChars, maxConcurrentJobsPerOrg: config.maxConcurrentJobsPerOrg, maxPerMonthPerOrg: config.maxPerMonthPerOrg },
    usage: { usedThisMonth, activeNow },
  };
}
