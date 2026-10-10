import "dotenv/config";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { purgeCanceledOrgs } from "@/lib/billing/purge";
import { CANCEL_RETENTION_MS } from "@/lib/billing/status-map";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { DEFAULT_ALLOWED_MIME, type StorageConfig } from "./config";
import { LocalStorageProvider } from "./providers/local";
import { deleteFile, getFileUrl, getUploadUrl, listFiles, purgeOrgFiles, reconcileOrgBlobs, uploadFile } from "./service";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const chunks = async function* (b: Buffer, size = 10) {
  for (let i = 0; i < b.length; i += size) yield b.subarray(i, i + size);
};

let dir: string;
let provider: LocalStorageProvider;
let a: TestOrg;
let b: TestOrg;
const cfg = (over: Partial<StorageConfig> = {}): StorageConfig => ({ provider: "local", container: "c", localDir: "", maxFileBytes: 1000, allowedMime: DEFAULT_ALLOWED_MIME, ...over });
const up = (o: TestOrg, over: Partial<{ category: string; fileName: string; contentType: string; body: Buffer; declaredSize: number | null }> = {}, c = cfg()) =>
  uploadFile({ orgId: o.orgId, userId: o.userId }, { category: "creative", fileName: "foto.png", contentType: "image/png", body: chunks(over.body ?? PNG), ...over, ...(over.body ? { body: chunks(over.body) } : {}) } as never, { provider, config: c });

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "lf-storage-svc-"));
  provider = new LocalStorageProvider(dir, "s".repeat(40));
  a = await createTestOrg("stor-a");
  b = await createTestOrg("stor-b");
});
afterAll(async () => {
  await purgeTestOrg(a);
  await purgeTestOrg(b);
  await rm(dir, { recursive: true, force: true });
});

describe("uploadFile / validacoes", () => {
  it("upload ok: chave orgs/{org}/creative/{uuid}-nome, sha256 e tamanho gravados, blob existe", async () => {
    const f = await up(a);
    const row = await prisma.storedFile.findUniqueOrThrow({ where: { id: f.id } });
    expect(row.orgId).toBe(a.orgId);
    expect(row.blobKey).toMatch(new RegExp(`^orgs/${a.orgId}/creative/${f.id}-foto\\.png$`));
    expect(row.sizeBytes).toBe(PNG.length);
    expect(row.sha256).toHaveLength(64);
    expect(row.uploadedByUserId).toBe(a.userId);
    expect(await provider.exists(row.blobKey)).toBe(true);
  });

  it("nome com path traversal vira basename seguro dentro do prefixo da org", async () => {
    const f = await up(a, { fileName: "../../../b/../../evil.png" });
    const row = await prisma.storedFile.findUniqueOrThrow({ where: { id: f.id } });
    expect(row.blobKey).toBe(`orgs/${a.orgId}/creative/${f.id}-evil.png`);
    expect(row.originalName).toBe("evil.png");
  });

  it("MIME fora da allowlist => 415, nada gravado", async () => {
    const before = await prisma.storedFile.count({ where: { orgId: a.orgId } });
    await expect(up(a, { contentType: "application/x-msdownload", fileName: "a.exe" })).rejects.toMatchObject({ status: 415 });
    await expect(up(a, { contentType: "text/html", fileName: "a.html" })).rejects.toMatchObject({ status: 415 });
    expect(await prisma.storedFile.count({ where: { orgId: a.orgId } })).toBe(before);
  });

  it("allowlist configuravel por env (config)", async () => {
    await expect(up(a, {}, cfg({ allowedMime: ["application/pdf"] }))).rejects.toMatchObject({ status: 415 });
  });

  it("magic bytes: .png que e outro conteudo => recusa e blob parcial removido", async () => {
    await expect(up(a, { body: Buffer.from("MZ este nao e um png de verdade, e um executavel") })).rejects.toMatchObject({ status: 415 });
    expect((await provider.list(`orgs/${a.orgId}/`)).filter((o) => o.sizeBytes < PNG.length).length).toBe(0);
  });

  it("tamanho: Content-Length declarado acima do limite => 413 sem ler o corpo", async () => {
    await expect(up(a, { declaredSize: 5000 })).rejects.toMatchObject({ status: 413 });
  });

  it("tamanho: stream que estoura o limite (declarado mentiroso) => 413, sem metadado e sem blob", async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(2000, 2)]);
    const before = (await provider.list(`orgs/${a.orgId}/`)).length;
    await expect(up(a, { body: big, declaredSize: 10 })).rejects.toMatchObject({ status: 413 });
    expect((await provider.list(`orgs/${a.orgId}/`)).length).toBe(before);
  });

  it("corpo vazio e categoria invalida => recusados", async () => {
    await expect(up(a, { body: Buffer.alloc(0) })).rejects.toMatchObject({ code: "validation" });
    await expect(up(a, { category: "../x" })).rejects.toMatchObject({ code: "validation" });
  });
});

describe("isolamento cross-org (vazamento)", () => {
  it("org B nao lista, nao le (URL), nao remove arquivo da org A (IDs adivinhados)", async () => {
    const f = await up(a, { fileName: "segredo.png" });
    const listB = await listFiles(b.orgId, {});
    expect(listB.items.find((i) => i.id === f.id)).toBeUndefined();
    expect((await listFiles(a.orgId, {})).items.find((i) => i.id === f.id)).toBeDefined();

    await expect(getFileUrl(b.orgId, f.id, {}, { provider })).rejects.toMatchObject({ code: "not_found" });
    await expect(deleteFile(b.orgId, f.id, { provider })).rejects.toMatchObject({ code: "not_found" });

    const row = await prisma.storedFile.findUniqueOrThrow({ where: { id: f.id } });
    expect(row.deletedAt).toBeNull();
    expect(await provider.exists(row.blobKey)).toBe(true);
    // a org A continua com acesso
    expect((await getFileUrl(a.orgId, f.id, {}, { provider })).url).toContain("sig=");
  });

  it("metadado de B adulterado para apontar sob o prefixo da org A nunca gera URL nem apaga blob alheio", async () => {
    const victim = await up(a, { fileName: "vitima.png" });
    const vKey = (await prisma.storedFile.findUniqueOrThrow({ where: { id: victim.id } })).blobKey;
    const evil = await up(b, { fileName: "mal.png" });
    const forged = `orgs/${a.orgId}/creative/forjada-x.png`;
    await prisma.storedFile.update({ where: { id: evil.id }, data: { blobKey: forged } });
    await expect(getFileUrl(b.orgId, evil.id, {}, { provider })).rejects.toMatchObject({ code: "not_found" });
    await expect(deleteFile(b.orgId, evil.id, { provider })).rejects.toMatchObject({ code: "not_found" });
    expect(await provider.exists(vKey)).toBe(true);
  });

  it("listagem: mesmas categorias, orgs distintas; getUploadUrl gera chave sob a org da sessao", async () => {
    const own = await listFiles(b.orgId, { category: "creative" });
    for (const i of own.items) {
      const r = await prisma.storedFile.findUniqueOrThrow({ where: { id: i.id } });
      expect(r.orgId).toBe(b.orgId);
    }
    await expect(getUploadUrl({ orgId: b.orgId }, { category: "creative", fileName: "x.png", contentType: "image/png" }, { provider, config: cfg() })).rejects.toThrow(); // local: sem upload direto
    await expect(getUploadUrl({ orgId: b.orgId }, { category: "creative", fileName: "x.exe", contentType: "application/x-msdownload" }, { provider, config: cfg() })).rejects.toMatchObject({ status: 415 });
  });
});

describe("listagem paginada / delete / reconciliacao", () => {
  it("cursor pagina sem repetir e filtra categoria", async () => {
    const c = await createTestOrg("stor-page");
    try {
      for (let i = 0; i < 5; i++) await up(c, { category: i % 2 ? "knowledge" : "creative", fileName: `f${i}.png` });
      const p1 = await listFiles(c.orgId, { limit: 2 });
      expect(p1.items).toHaveLength(2);
      expect(p1.nextCursor).not.toBeNull();
      const p2 = await listFiles(c.orgId, { limit: 2, cursor: p1.nextCursor });
      const p3 = await listFiles(c.orgId, { limit: 2, cursor: p2.nextCursor });
      const ids = [...p1.items, ...p2.items, ...p3.items].map((i) => i.id);
      expect(new Set(ids).size).toBe(5);
      expect(p3.nextCursor).toBeNull();
      expect((await listFiles(c.orgId, { category: "knowledge" })).items).toHaveLength(2);
      await expect(listFiles(c.orgId, { category: "x" })).rejects.toMatchObject({ code: "validation" });
    } finally {
      await purgeOrgFiles(c.orgId, { provider });
      await purgeTestOrg(c);
    }
  });

  it("deleteFile: soft delete + blob removido; some da listagem e da URL", async () => {
    const f = await up(a, { fileName: "del.png" });
    const key = (await prisma.storedFile.findUniqueOrThrow({ where: { id: f.id } })).blobKey;
    await deleteFile(a.orgId, f.id, { provider });
    const row = await prisma.storedFile.findUniqueOrThrow({ where: { id: f.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(await provider.exists(key)).toBe(false);
    expect((await listFiles(a.orgId, {})).items.find((i) => i.id === f.id)).toBeUndefined();
    await expect(getFileUrl(a.orgId, f.id, {}, { provider })).rejects.toMatchObject({ code: "not_found" });
    await expect(deleteFile(a.orgId, f.id, { provider })).rejects.toMatchObject({ code: "not_found" });
  });

  it("TTL da URL e limitado (max 900s)", async () => {
    const f = await up(a, { fileName: "ttl.png" });
    expect((await getFileUrl(a.orgId, f.id, { ttlSeconds: 999999 }, { provider })).expiresInSeconds).toBe(900);
  });

  it("reconcileOrgBlobs: remove orfao antigo, preserva vivo e orfao recente (upload em andamento)", async () => {
    const c = await createTestOrg("stor-rec");
    try {
      const live = await up(c, { fileName: "vivo.png" });
      const liveKey = (await prisma.storedFile.findUniqueOrThrow({ where: { id: live.id } })).blobKey;
      const orphanKey = `orgs/${c.orgId}/creative/orfao-x.png`;
      const { Readable } = await import("node:stream");
      await provider.put(orphanKey, Readable.from([PNG]));
      expect(await reconcileOrgBlobs(c.orgId, {}, { provider })).toBe(0); // recente: carencia
      expect(await reconcileOrgBlobs(c.orgId, { now: new Date(Date.now() + 2 * 3600_000) }, { provider })).toBe(1);
      expect(await provider.exists(orphanKey)).toBe(false);
      expect(await provider.exists(liveKey)).toBe(true);
    } finally {
      await purgeOrgFiles(c.orgId, { provider });
      await purgeTestOrg(c);
    }
  });

  it("falha do provider no put => sem metadado; erro de infra nao vaza no log (sem segredo)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = Object.assign(Object.create(provider), { put: async () => { throw new Error("AccountKey=SEGREDO123"); } });
    const before = await prisma.storedFile.count({ where: { orgId: a.orgId } });
    await expect(uploadFile({ orgId: a.orgId, userId: a.userId }, { category: "creative", fileName: "x.png", contentType: "image/png", body: chunks(PNG) }, { provider: broken, config: cfg() })).rejects.toThrow();
    expect(await prisma.storedFile.count({ where: { orgId: a.orgId } })).toBe(before);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("SEGREDO123");
    spy.mockRestore();
  });
});

describe("purga SPEC-033 (D-33-4) remove os blobs da org", () => {
  it("purgeCanceledOrgs (> 90 dias) apaga orgs/{orgId}/ da org expurgada e NAO toca a outra org", async () => {
    const prev = { p: process.env.STORAGE_PROVIDER, d: process.env.STORAGE_LOCAL_DIR };
    process.env.STORAGE_PROVIDER = "local";
    process.env.STORAGE_LOCAL_DIR = dir;
    try {
      const c = await createTestOrg("stor-purge");
      const keep = await up(b, { fileName: "keep.png" });
      const f1 = await up(c, { fileName: "p1.png" });
      const f2 = await up(c, { fileName: "p2.png", category: "knowledge" });
      expect((await provider.list(`orgs/${c.orgId}/`)).length).toBe(2);
      const planId = (await prisma.plan.findUniqueOrThrow({ where: { key: "starter" }, select: { id: true } })).id;
      const now = new Date();
      await prisma.subscription.create({ data: { orgId: c.orgId, planId, status: "canceled", cadence: "monthly", canceledAt: new Date(now.getTime() - (CANCEL_RETENTION_MS + 86400_000)) } });
      const r = await purgeCanceledOrgs(now);
      expect(r.errors).toBe(0);
      expect(await provider.list(`orgs/${c.orgId}/`)).toEqual([]);
      const rows = await prisma.storedFile.findMany({ where: { id: { in: [f1.id, f2.id] } } });
      expect(rows.every((x) => x.deletedAt)).toBe(true);
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: c.orgId } })).purgedAt).not.toBeNull();
      const keepRow = await prisma.storedFile.findUniqueOrThrow({ where: { id: keep.id } });
      expect(await provider.exists(keepRow.blobKey)).toBe(true);
      expect(keepRow.deletedAt).toBeNull();
      await prisma.subscription.deleteMany({ where: { orgId: c.orgId } });
      await purgeTestOrg(c);
    } finally {
      if (prev.p === undefined) delete process.env.STORAGE_PROVIDER; else process.env.STORAGE_PROVIDER = prev.p;
      if (prev.d === undefined) delete process.env.STORAGE_LOCAL_DIR; else process.env.STORAGE_LOCAL_DIR = prev.d;
    }
  });
});
