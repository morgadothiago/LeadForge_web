import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { signInAs, signOut } from "@/lib/auth/test-helpers";
import { processCreativeJobs } from "@/lib/creatives/runner";
import { _resetCreativeProviderForTests } from "@/lib/creatives/factory";
import { getFileUrl } from "@/lib/storage/service";
import { LocalStorageProvider } from "@/lib/storage/providers/local";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";
import {
  cancelCreative, createCreativeDraft, deleteCreative, getCreative, getCreativeVideoUrl, listAvatarsAndVoices, listCreatives, retryCreative, submitCreative,
} from "./creative";

/**
 * SPEC-051 (051a) — actions de criativos de ponta a ponta com o provedor MOCK (CREATIVE_MOCK_DELAY_MS=0) e storage `local`
 * em diretorio temporario: criar -> enviar -> runner (tick) -> ready -> URL de leitura; quotas; isolamento cross-org
 * (inclusive 1 usuario em 2 orgs com org ativa trocada); sem vazamento; nunca chama provedor real.
 */
const SECRET_CONN = "DefaultEndpointsProtocol=https;AccountName=zz;AccountKey=SEGREDO-NAO-PODE-VAZAR-123==";
const ENV_KEYS = ["CREATIVE_MOCK_DELAY_MS", "CREATIVE_MAX_CONCURRENT_JOBS_PER_ORG", "CREATIVE_MAX_PER_MONTH_PER_ORG", "CREATIVE_SCRIPT_BLOCKLIST", "CREATIVE_MAX_DURATION_SEC", "CREATIVE_MAX_SCRIPT_CHARS", "STORAGE_PROVIDER", "STORAGE_LOCAL_DIR", "AZURE_STORAGE_CONNECTION_STRING", "CREATIVE_PROVIDER"] as const;
const saved: Record<string, string | undefined> = {};

let dir: string;
let A: TestOrg;
let B: TestOrg;
let memberA: string;
let multi: string;
let fetchSpy: ReturnType<typeof vi.spyOn>;

const base = (over: Record<string, unknown> = {}) => ({ title: "Campanha de lançamento", script: "Olá! Conheça nossa solução em poucos segundos.", language: "pt-BR", avatarRef: "mock-ana", voiceRef: "mock-voz-br-f", aspectRatio: "9:16", ...over });
async function mkDraft(over: Record<string, unknown> = {}) {
  const r = await createCreativeDraft(base(over));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.data;
}
async function tick(n = 2) {
  for (let i = 0; i < n; i++) await processCreativeJobs(new Date(Date.now() + i * 120_000), { maxJobs: 500 });
}
const err = (r: { ok: boolean; errors?: Record<string, string[]> }) => (r.ok ? "" : (r.errors?._form ?? Object.values(r.errors ?? {}).flat()).join(" | "));

beforeAll(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  dir = await mkdtemp(path.join(os.tmpdir(), "lf-creatives-act-"));
  A = await createTestOrg("cr-act-a");
  B = await createTestOrg("cr-act-b");
  memberA = randomUUID();
  await prisma.user.create({ data: { id: memberA, name: "zz member", email: `zz-cr-member-${memberA.slice(0, 8)}@test.local`, role: "provider" } });
  await prisma.membership.create({ data: { userId: memberA, orgId: A.orgId, orgRole: "member" } });
  multi = randomUUID();
  await prisma.user.create({ data: { id: multi, name: "zz multi", email: `zz-cr-multi-${multi.slice(0, 8)}@test.local`, role: "provider" } });
  await prisma.membership.create({ data: { userId: multi, orgId: A.orgId, orgRole: "member" } });
  await prisma.membership.create({ data: { userId: multi, orgId: B.orgId, orgRole: "member" } });
});
beforeEach(async () => {
  process.env.CREATIVE_MOCK_DELAY_MS = "0";
  process.env.STORAGE_PROVIDER = "local";
  process.env.STORAGE_LOCAL_DIR = dir;
  process.env.AZURE_STORAGE_CONNECTION_STRING = SECRET_CONN; // segredo "de mentira" presente no ambiente: nunca pode aparecer em saidas
  process.env.STORAGE_PROVIDER = "local";
  delete process.env.CREATIVE_MAX_CONCURRENT_JOBS_PER_ORG;
  delete process.env.CREATIVE_MAX_PER_MONTH_PER_ORG;
  delete process.env.CREATIVE_SCRIPT_BLOCKLIST;
  delete process.env.CREATIVE_MAX_DURATION_SEC;
  delete process.env.CREATIVE_MAX_SCRIPT_CHARS;
  delete process.env.CREATIVE_PROVIDER;
  _resetCreativeProviderForTests();
  const orgIds = [A.orgId, B.orgId];
  await prisma.creativeJob.deleteMany({ where: { orgId: { in: orgIds } } });
  await prisma.creative.deleteMany({ where: { orgId: { in: orgIds } } });
  await prisma.organization.updateMany({ where: { id: { in: orgIds } }, data: { status: "active" } });
  await signInAs(A.userId);
  fetchSpy = vi.spyOn(globalThis, "fetch");
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled(); // nunca chama provedor/servico real
  vi.restoreAllMocks();
});
afterAll(async () => {
  signOut();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await prisma.membership.deleteMany({ where: { userId: { in: [memberA, multi] } } });
  await prisma.user.deleteMany({ where: { id: { in: [memberA, multi] } } });
  await purgeTestOrg(A);
  await purgeTestOrg(B);
  await rm(dir, { recursive: true, force: true });
});

describe("fluxo ponta a ponta (mock)", () => {
  it("rascunho -> enviar -> tick -> ready; biblioteca lista; URL de leitura SAS curta (leitura do blob por org)", async () => {
    const d = await mkDraft();
    expect(d).toMatchObject({ status: "draft", job: null, hasVideo: false, language: "pt-BR", aspectRatio: "9:16" });
    expect(d.durationSec).toBeGreaterThan(0);
    const sub = await submitCreative(d.id);
    expect(sub.ok && sub.data.status).toBe("queued");
    expect(sub.ok && sub.data.job).toMatchObject({ runNo: 1, status: "queued" });

    await tick();
    const got = await getCreative(d.id);
    expect(got.ok && got.data).toMatchObject({ status: "ready", hasVideo: true, error: null });
    expect(got.ok && got.data.jobs).toHaveLength(1);

    const list = await listCreatives({ status: "ready" });
    expect(list.ok && list.data.items.map((c) => c.id)).toEqual([d.id]);

    const url = await getCreativeVideoUrl(d.id);
    expect(url.ok).toBe(true);
    if (url.ok) {
      expect(url.data.expiresInSeconds).toBeLessThanOrEqual(900);
      expect(url.data.url).toContain("/api/storage/local");
    }
  });

  it("getCreativeVideoUrl antes de pronto => erro PT-BR", async () => {
    const d = await mkDraft();
    expect(err(await getCreativeVideoUrl(d.id))).toMatch(/ainda não está disponível/);
  });

  it("deleteCreative remove o blob (SPEC-050) e some da biblioteca; segue contando na cota", async () => {
    const d = await mkDraft();
    await submitCreative(d.id);
    await tick();
    const c = await prisma.creative.findUniqueOrThrow({ where: { id: d.id } });
    const file = await prisma.storedFile.findUniqueOrThrow({ where: { id: c.videoFileId! } });
    const store = new LocalStorageProvider(dir, process.env.AUTH_SECRET ?? "");
    expect(await store.exists(file.blobKey)).toBe(true);
    expect((await deleteCreative(d.id)).ok).toBe(true);
    expect(await store.exists(file.blobKey)).toBe(false);
    expect((await prisma.storedFile.findUniqueOrThrow({ where: { id: file.id } })).deletedAt).not.toBeNull();
    const row = await prisma.creative.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.submittedAt).not.toBeNull();
    const list = await listCreatives({});
    expect(list.ok && list.data.items).toHaveLength(0);
    expect(err(await getCreative(d.id))).toMatch(/não encontrado/);
    const cat = await listAvatarsAndVoices();
    expect(cat.ok && cat.data.usage.usedThisMonth).toBe(1);
  });

  it("excluir criativo ativo cancela antes (provedor/jobs encerrados)", async () => {
    process.env.CREATIVE_MOCK_DELAY_MS = "600000";
    const d = await mkDraft();
    await submitCreative(d.id);
    await tick(1);
    expect((await deleteCreative(d.id)).ok).toBe(true);
    const jobs = await prisma.creativeJob.findMany({ where: { creativeId: d.id } });
    expect(jobs.every((j) => j.status === "canceled")).toBe(true);
  });

  it("listAvatarsAndVoices: catalogo do mock, limites e uso", async () => {
    const r = await listAvatarsAndVoices();
    expect(r.ok && r.data).toMatchObject({
      provider: "mock",
      limits: { maxDurationSec: 120, maxScriptChars: 3000, maxConcurrentJobsPerOrg: 2, maxPerMonthPerOrg: 20 },
      usage: { usedThisMonth: 0, activeNow: 0 },
    });
    expect(r.ok && r.data.avatars.length).toBeGreaterThan(0);
    expect(r.ok && r.data.voices.some((v) => v.language === "en")).toBe(true);
  });
});

describe("listagem: paginacao e filtros", () => {
  it("cursor, filtro por status e busca por titulo", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await mkDraft({ title: i === 3 ? "Especial XYZ" : `Item ${i}` })).id);
    await submitCreative(ids[0]);
    const p1 = await listCreatives({ limit: 2 });
    expect(p1.ok && p1.data.items).toHaveLength(2);
    const next = p1.ok ? p1.data.nextCursor : null;
    expect(next).toBeTruthy();
    const p2 = await listCreatives({ limit: 2, cursor: next });
    const p3 = await listCreatives({ limit: 2, cursor: p2.ok ? p2.data.nextCursor : null });
    const all = [p1, p2, p3].flatMap((p) => (p.ok ? p.data.items.map((c) => c.id) : []));
    expect(new Set(all).size).toBe(5);
    expect(p3.ok && p3.data.nextCursor).toBeNull();
    const q = await listCreatives({ q: "xyz" });
    expect(q.ok && q.data.items.map((c) => c.id)).toEqual([ids[3]]);
    const queued = await listCreatives({ status: "queued" });
    expect(queued.ok && queued.data.items.map((c) => c.id)).toEqual([ids[0]]);
    expect(err(await listCreatives({ status: "invalido" }))).not.toBe("");
  });
});

describe("validacoes e moderacao minima", () => {
  it("campos obrigatorios/enum (zod) por campo", async () => {
    const r = await createCreativeDraft({ title: "", script: "", language: "fr", avatarRef: "", voiceRef: "", aspectRatio: "4:3" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["aspectRatio", "avatarRef", "language", "script", "title", "voiceRef"]);
  });
  it("avatar/voz fora do catalogo e voz de outro idioma sao recusados", async () => {
    expect(err(await createCreativeDraft(base({ avatarRef: "outro" })))).toMatch(/Avatar inválido/);
    expect(err(await createCreativeDraft(base({ voiceRef: "outra" })))).toMatch(/Voz inválida/);
    expect(err(await createCreativeDraft(base({ language: "en" })))).toMatch(/não corresponde ao idioma/);
    expect((await createCreativeDraft(base({ language: "en", voiceRef: "mock-voice-en-f", aspectRatio: "16:9" }))).ok).toBe(true);
  });
  it("limite de caracteres e blocklist configuravel por env", async () => {
    process.env.CREATIVE_MAX_SCRIPT_CHARS = "40";
    expect(err(await createCreativeDraft(base({ script: "a ".repeat(30) })))).toMatch(/limite de 40/);
    delete process.env.CREATIVE_MAX_SCRIPT_CHARS;
    process.env.CREATIVE_SCRIPT_BLOCKLIST = "golpe,pirâmide";
    expect(err(await createCreativeDraft(base({ script: "Isso nao e um GOLPE" })))).toMatch(/termos não permitidos/);
  });
  it("duracao maxima configuravel (default 120s) pelo roteiro ou pelo durationSec", async () => {
    expect(err(await createCreativeDraft(base({ script: Array(310).fill("palavra").join(" ") })))).toMatch(/excede o máximo de 120s/);
    expect(err(await createCreativeDraft(base({ durationSec: 121 })))).toMatch(/excede o máximo/);
    process.env.CREATIVE_MAX_DURATION_SEC = "300";
    expect((await createCreativeDraft(base({ script: Array(310).fill("palavra").join(" ") }))).ok).toBe(true);
  });
  it("transicoes invalidas: enviar nao-rascunho, cancelar rascunho, retry de pronto", async () => {
    const d = await mkDraft();
    expect(err(await cancelCreative(d.id))).toMatch(/fila ou em processamento/);
    expect(err(await retryCreative(d.id))).toMatch(/falha ou cancelados/);
    await submitCreative(d.id);
    await tick();
    expect(err(await submitCreative(d.id))).toMatch(/já foi gerado/);
    expect(err(await retryCreative(d.id))).toMatch(/já foi gerado/);
  });
});

describe("quotas e protecao de custo (D-051-6)", () => {
  it("limite de geracoes simultaneas por org (env) — 3a envio recusado; libera ao concluir", async () => {
    process.env.CREATIVE_MOCK_DELAY_MS = "600000";
    const [a, b, c] = [await mkDraft(), await mkDraft(), await mkDraft()];
    expect((await submitCreative(a.id)).ok).toBe(true);
    expect((await submitCreative(b.id)).ok).toBe(true);
    expect(err(await submitCreative(c.id))).toMatch(/Limite de 2 geração/);
    expect((await cancelCreative(a.id)).ok).toBe(true);
    expect((await submitCreative(c.id)).ok).toBe(true);
  });
  it("concorrencia: envios simultaneos nao ultrapassam o limite (advisory lock)", async () => {
    process.env.CREATIVE_MAX_CONCURRENT_JOBS_PER_ORG = "1";
    const ds = await Promise.all([mkDraft(), mkDraft(), mkDraft()]);
    const rs = await Promise.all(ds.map((d) => submitCreative(d.id)));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(await prisma.creativeJob.count({ where: { orgId: A.orgId } })).toBe(1);
  });
  it("cota mensal por org: acima do limite recusa; cancelar antes do provedor devolve; retry de falha nao consome de novo", async () => {
    process.env.CREATIVE_MAX_PER_MONTH_PER_ORG = "2";
    process.env.CREATIVE_MAX_CONCURRENT_JOBS_PER_ORG = "10";
    const d1 = await mkDraft({ script: "falha [[mock:fail]]" });
    const d2 = await mkDraft();
    const d3 = await mkDraft();
    await submitCreative(d1.id);
    await submitCreative(d2.id);
    expect(err(await submitCreative(d3.id))).toMatch(/Limite mensal de 2/);
    await cancelCreative(d2.id); // antes do provedor => devolve a cota
    expect((await submitCreative(d3.id)).ok).toBe(true);
    await tick(); // d1 falha no provedor
    expect((await getCreative(d1.id)) as never).toMatchObject({ ok: true, data: { status: "failed" } });
    const retry = await retryCreative(d1.id); // mes ja contado: nao consome nova cota mesmo no limite
    expect(retry.ok).toBe(true);
    const usage = await listAvatarsAndVoices();
    expect(usage.ok && usage.data.usage.usedThisMonth).toBe(2);
  });
  it("retry de falha de mes anterior volta a exigir cota", async () => {
    process.env.CREATIVE_MAX_PER_MONTH_PER_ORG = "1";
    const old = await mkDraft({ script: "falha [[mock:fail]]" });
    await submitCreative(old.id);
    await tick();
    await prisma.creative.update({ where: { id: old.id }, data: { submittedAt: new Date("2020-01-15T00:00:00Z") } });
    const other = await mkDraft();
    await submitCreative(other.id); // usa a cota do mes
    expect(err(await retryCreative(old.id))).toMatch(/Limite mensal/);
  });
  it("org suspensa: escrita bloqueada, leitura liberada", async () => {
    const d = await mkDraft();
    await prisma.organization.update({ where: { id: A.orgId }, data: { status: "suspended" } });
    expect(err(await submitCreative(d.id))).toMatch(/Assinatura pendente/);
    expect(err(await createCreativeDraft(base()))).toMatch(/Assinatura pendente/);
    expect((await listCreatives({})).ok).toBe(true);
    expect((await getCreative(d.id)).ok).toBe(true);
  });
});

describe("papeis (D-051-3)", () => {
  it("member cria/envia/cancela; excluir so owner ou criador", async () => {
    await signInAs(memberA);
    const mine = await mkDraft({ title: "do member" });
    expect((await submitCreative(mine.id)).ok).toBe(true);
    expect((await cancelCreative(mine.id)).ok).toBe(true);
    const ownerOne = await (async () => {
      await signInAs(A.userId);
      return mkDraft({ title: "do owner" });
    })();
    await signInAs(memberA);
    expect(err(await deleteCreative(ownerOne.id))).toMatch(/dono da organização ou quem criou/);
    expect((await deleteCreative(mine.id)).ok).toBe(true); // criador
    await signInAs(A.userId);
    expect((await deleteCreative(ownerOne.id)).ok).toBe(true);
    const another = await (async () => { await signInAs(memberA); return mkDraft({ title: "member 2" }); })();
    await signInAs(A.userId);
    expect((await deleteCreative(another.id)).ok).toBe(true); // owner exclui de outro membro
  });
  it("sem sessao e platform_admin (sem org) nao operam", async () => {
    signOut();
    expect(err(await listCreatives({}))).toMatch(/Sessão expirada/);
    await signInAs(A.userId, { orgId: null, platformRole: "platform_admin" });
    expect(err(await createCreativeDraft(base()))).toMatch(/Sem permissão/);
    expect(err(await listAvatarsAndVoices())).toMatch(/Sem permissão/);
  });
});

describe("isolamento cross-org", () => {
  it("criativo/arquivo da org B inacessivel para A (ID adivinhado) em todas as actions", async () => {
    await signInAs(B.userId);
    const theirs = await mkDraft({ title: "segredo da B" });
    const ready = await mkDraft({ title: "pronto da B" });
    await submitCreative(ready.id);
    await tick();
    const readyRow = await prisma.creative.findUniqueOrThrow({ where: { id: ready.id } });
    expect(readyRow.status).toBe("ready");

    await signInAs(A.userId);
    const nf = /Criativo não encontrado/;
    for (const r of [await getCreative(theirs.id), await submitCreative(theirs.id), await cancelCreative(theirs.id), await retryCreative(theirs.id), await deleteCreative(theirs.id), await getCreativeVideoUrl(ready.id), await deleteCreative(ready.id)]) {
      expect(err(r)).toMatch(nf);
    }
    const list = await listCreatives({});
    expect(list.ok && list.data.items).toHaveLength(0);
    // arquivo (SPEC-050) da B nao sai nem pela camada de storage com a org da sessao A
    await expect(getFileUrl(A.orgId, readyRow.videoFileId!)).rejects.toMatchObject({ code: "not_found" });
    expect(await scopedPrisma(A.orgId).storedFile.findFirst({ where: { id: readyRow.videoFileId! } })).toBeNull();
    // nada mudou na B
    expect((await prisma.creative.findUniqueOrThrow({ where: { id: ready.id } })).deletedAt).toBeNull();
    expect((await prisma.creative.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe("draft");
  });

  it("scopedPrisma isola creative/creativeJob e injeta orgId na criacao", async () => {
    const mine = await scopedPrisma(A.orgId).creative.create({ data: { title: "t", script: "s", language: "pt-BR", avatarRef: "a", voiceRef: "v", aspectRatio: "1:1", createdBy: A.userId, orgId: B.orgId } });
    expect(mine.orgId).toBe(A.orgId);
    expect(await scopedPrisma(B.orgId).creative.findFirst({ where: { id: mine.id } })).toBeNull();
    expect(await scopedPrisma(B.orgId).creative.count()).toBe(0);
    await expect(scopedPrisma(B.orgId).creative.update({ where: { id: mine.id }, data: { title: "x" } })).rejects.toThrow(/não encontrado/);
  });

  it("usuario em 2 orgs: so ve a org ativa; trocar a org ativa (JWT) troca o conjunto; IDs da outra org => nao encontrado", async () => {
    await signInAs(multi, { orgId: A.orgId, platformRole: "provider" });
    const inA = await mkDraft({ title: "multi-A" });
    await signInAs(multi, { orgId: B.orgId, platformRole: "provider" });
    const inB = await mkDraft({ title: "multi-B" });
    let l = await listCreatives({});
    expect(l.ok && l.data.items.map((c) => c.id)).toEqual([inB.id]);
    expect(err(await getCreative(inA.id))).toMatch(/não encontrado/);
    expect(err(await submitCreative(inA.id))).toMatch(/não encontrado/);
    expect(err(await deleteCreative(inA.id))).toMatch(/não encontrado/);

    await signInAs(multi, { orgId: A.orgId, platformRole: "provider" });
    l = await listCreatives({});
    expect(l.ok && l.data.items.map((c) => c.id)).toEqual([inA.id]);
    expect(err(await getCreative(inB.id))).toMatch(/não encontrado/);
    // orgId vindo do cliente e ignorado: o input nao tem campo de org e a gravacao usa a sessao
    const forged = await createCreativeDraft(base({ orgId: B.orgId }));
    expect(forged.ok).toBe(true);
    expect(await prisma.creative.count({ where: { orgId: B.orgId, id: forged.ok ? forged.data.id : "" } })).toBe(0);
    // membership removida => sessao daquela org deixa de valer
    await prisma.membership.delete({ where: { userId_orgId: { userId: multi, orgId: A.orgId } } });
    expect(err(await listCreatives({}))).toMatch(/Sessão expirada/);
    await prisma.membership.create({ data: { userId: multi, orgId: A.orgId, orgRole: "member" } });
  });
});

describe("sem vazamento", () => {
  it("saidas das actions nao expõem orgId, ids/chaves do provedor/blob, idempotencyKey nem segredos do ambiente", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a) => void logs.push(a.map(String).join(" ")));
    vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.map(String).join(" ")));
    const d = await mkDraft();
    const outs: unknown[] = [d, await submitCreative(d.id)];
    await tick();
    outs.push(await getCreative(d.id), await listCreatives({}), await listAvatarsAndVoices());
    // a URL de leitura (SPEC-050) carrega a chave do blob por desenho (como a SAS do Azure): so garantimos que nao ha segredo nela
    const url = await getCreativeVideoUrl(d.id);
    expect(JSON.stringify(url)).not.toMatch(/SEGREDO-NAO-PODE-VAZAR|AccountKey/);
    const f = await mkDraft({ script: "x [[mock:fail]]" });
    await submitCreative(f.id);
    await tick();
    outs.push(await getCreative(f.id), await createCreativeDraft(base({ avatarRef: "zz" })));
    const dump = JSON.stringify(outs);
    for (const bad of ["providerJobId", "idempotencyKey", "blobKey", "mock_", `orgs/${A.orgId}`, A.orgId, "SEGREDO-NAO-PODE-VAZAR", "AccountKey"]) {
      // a URL assinada local nao contem a connection string; orgId nao e retornado em nenhuma view
      expect(dump.includes(bad), `vazou: ${bad}`).toBe(false);
    }
    expect(logs.join("\n")).not.toMatch(/SEGREDO-NAO-PODE-VAZAR|AccountKey/);
    expect(Object.keys((d as unknown) as object)).not.toContain("orgId");
  });

  it("CREATIVE_PROVIDER desconhecido: feature indisponivel com erro generico (sem rede, sem detalhe)", async () => {
    process.env.CREATIVE_PROVIDER = "heygen";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await listAvatarsAndVoices();
    expect(err(r)).toBe("Geração de criativos indisponível no momento.");
  });
});
