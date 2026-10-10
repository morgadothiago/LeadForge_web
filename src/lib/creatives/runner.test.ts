import "dotenv/config";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { DEFAULT_ALLOWED_MIME, type StorageConfig } from "@/lib/storage/config";
import { LocalStorageProvider } from "@/lib/storage/providers/local";
import { getCreativeConfig, type CreativeConfig } from "./config";
import { MockAvatarVideoProvider } from "./providers/mock";
import { processCreativeJobs, LEASE_MS } from "./runner";
import { cancelCreative, createCreativeDraft, retryCreative, submitCreative, type Deps } from "./service";

/**
 * SPEC-051 — maquina de estados do job: sucesso, falha, timeout, retry (sem duplicar), cancelamento, job preso.
 * Provedor SEMPRE o mock com relogio injetado (nunca rede); storage `local` em diretorio temporario.
 */
const T0 = new Date("2026-10-11T12:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const sc = (over: Partial<StorageConfig> = {}): StorageConfig => ({ provider: "local", container: "c", localDir: "", maxFileBytes: 1_000_000, allowedMime: DEFAULT_ALLOWED_MIME, ...over });

let dir: string;
let storage: LocalStorageProvider;
let A: TestOrg;
let B: TestOrg;
let clockMs = 0;

function mk(over: Partial<CreativeConfig> = {}, delayMs = 0) {
  const provider = new MockAvatarVideoProvider({ delayMs, now: () => T0.getTime() + clockMs });
  const config = { ...getCreativeConfig({ NODE_ENV: "test" }), ...over };
  const deps: Deps = { provider, config, storage: { provider: storage, config: sc() }, now: T0 };
  return { provider, config, deps };
}
const rd = (deps: Deps, over: Record<string, unknown> = {}) => ({ provider: deps.provider, config: deps.config, storage: deps.storage, random: () => 0.5, ...over });
async function draft(org: TestOrg, deps: Deps, script = "Olá, este é um roteiro curto.") {
  return createCreativeDraft({ orgId: org.orgId, userId: org.userId }, { title: "Meu criativo", script, language: "pt-BR", avatarRef: "mock-ana", voiceRef: "mock-voz-br-f", aspectRatio: "9:16" }, deps);
}
const ctx = (o: TestOrg) => ({ orgId: o.orgId, userId: o.userId });
const jobs = (creativeId: string) => prisma.creativeJob.findMany({ where: { creativeId }, orderBy: { runNo: "asc" } });
const creative = (id: string) => prisma.creative.findUniqueOrThrow({ where: { id } });
async function submit(org: TestOrg, deps: Deps, script?: string) {
  const d = await draft(org, deps, script);
  await submitCreative(ctx(org), d.id, deps);
  return d.id;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "lf-creatives-"));
  storage = new LocalStorageProvider(dir, "s".repeat(40));
  A = await createTestOrg("cr-run-a");
  B = await createTestOrg("cr-run-b");
});
beforeEach(async () => {
  // isolamento entre testes: o runner e cross-tenant por design (pega TODO job devido), entao zera a fila das 2 orgs
  const orgIds = [A.orgId, B.orgId];
  await prisma.creativeJob.deleteMany({ where: { orgId: { in: orgIds } } });
  await prisma.creative.deleteMany({ where: { orgId: { in: orgIds } } });
  await prisma.organization.updateMany({ where: { id: { in: orgIds } }, data: { status: "active" } });
});
afterAll(async () => {
  await purgeTestOrg(A);
  await purgeTestOrg(B);
  await rm(dir, { recursive: true, force: true });
});

describe("sucesso", () => {
  it("queued -> processing -> ready: video por stream no storage (category=creative, sob orgs/{org}/), job succeeded", async () => {
    clockMs = 0;
    const { provider, deps } = mk({}, 1000);
    const id = await submit(A, deps);
    expect((await creative(id)).status).toBe("queued");

    let s = await processCreativeJobs(T0, rd(deps));
    expect(s).toMatchObject({ picked: 1, advanced: 1 });
    expect((await creative(id)).status).toBe("processing");
    const j1 = (await jobs(id))[0];
    expect(j1).toMatchObject({ status: "processing", attempts: 1, providerJobId: expect.stringMatching(/^mock_/), idempotencyKey: `creative:${id}:run:1` });
    expect(j1.nextRunAt.getTime()).toBeGreaterThan(T0.getTime());

    // ainda nao venceu o backoff: nada a fazer (nao chama o provedor)
    const statusCalls = provider.stats.status;
    s = await processCreativeJobs(at(1), rd(deps));
    expect(s.picked).toBe(0);
    expect(provider.stats.status).toBe(statusCalls);

    clockMs = 2000;
    s = await processCreativeJobs(at(2 * 60_000), rd(deps));
    expect(s).toMatchObject({ picked: 1, succeeded: 1 });
    const c = await creative(id);
    expect(c).toMatchObject({ status: "ready", error: null });
    const file = await prisma.storedFile.findUniqueOrThrow({ where: { id: c.videoFileId! } });
    expect(file).toMatchObject({ orgId: A.orgId, category: "creative", mimeType: "video/mp4", uploadedByUserId: A.userId, deletedAt: null });
    expect(file.blobKey.startsWith(`orgs/${A.orgId}/creative/`)).toBe(true);
    expect(await storage.exists(file.blobKey)).toBe(true);
    expect((await jobs(id))[0]).toMatchObject({ status: "succeeded", progressPct: 100, costActualCents: 0, lockedAt: null });
    expect(provider.stats.create).toBe(1);
    // job concluido nao e reprocessado
    expect((await processCreativeJobs(at(10 * 60_000), rd(deps))).picked).toBe(0);
  });
});

describe("falha", () => {
  it("provedor reporta falha => failed com mensagem PT-BR; retry cria novo job (runNo 2) e chama o provedor de novo", async () => {
    clockMs = 0;
    const { provider, deps } = mk();
    const id = await submit(A, deps, "Roteiro [[mock:fail]]");
    await processCreativeJobs(T0, rd(deps)); // cria no provedor
    await processCreativeJobs(at(60_000), rd(deps)); // consulta -> failed
    const c = await creative(id);
    expect(c.status).toBe("failed");
    expect(c.error).toMatch(/provedor não conseguiu/i);
    expect((await jobs(id))[0]).toMatchObject({ status: "failed", failureKind: "provider_failed" });

    await retryCreative(ctx(A), id, deps);
    const all = await jobs(id);
    expect(all.map((j) => j.runNo)).toEqual([1, 2]);
    expect(all[1]).toMatchObject({ status: "queued", providerJobId: null, idempotencyKey: `creative:${id}:run:2` });
    expect(provider.stats.create).toBe(1); // ainda nao executou
  });

  it("provedor recusa (nao retentavel) => failed provider_rejected na 1a tentativa", async () => {
    const { deps } = mk();
    const id = await submit(A, deps, "Roteiro [[mock:reject]]");
    await processCreativeJobs(T0, rd(deps));
    expect((await jobs(id))[0]).toMatchObject({ status: "failed", failureKind: "provider_rejected", attempts: 0 });
    expect((await creative(id)).error).toMatch(/recusou/i);
  });

  it("indisponibilidade retentavel na criacao: reagenda com backoff; ao esgotar tentativas => failed provider_unavailable", async () => {
    const { deps } = mk({ jobMaxAttempts: 3 });
    const id = await submit(A, deps, "Roteiro [[mock:unavailable]]");
    await processCreativeJobs(T0, rd(deps));
    let j = (await jobs(id))[0];
    expect(j).toMatchObject({ status: "queued", attempts: 1, lockedAt: null });
    expect(j.nextRunAt.getTime()).toBe(T0.getTime() + 10_000); // base 5s * 2^1, jitter neutro
    await processCreativeJobs(at(60_000), rd(deps));
    await processCreativeJobs(at(120_000), rd(deps));
    j = (await jobs(id))[0];
    expect(j).toMatchObject({ status: "failed", failureKind: "provider_unavailable" });
  });

  it("erro retentavel no status: nao falha o job, so reagenda e conta tentativa", async () => {
    clockMs = 0;
    const { provider, deps } = mk({}, 0);
    const id = await submit(A, deps);
    await processCreativeJobs(T0, rd(deps));
    provider.failNextStatus = 1;
    await processCreativeJobs(at(60_000), rd(deps));
    expect((await jobs(id))[0]).toMatchObject({ status: "processing", attempts: 2 });
    await processCreativeJobs(at(120_000), rd(deps));
    expect((await creative(id)).status).toBe("ready");
  });
});

describe("timeout e retry sem duplicar cobranca", () => {
  it("passou do deadline => failed timeout; retry REAPROVEITA o job do provedor (create nao e chamado de novo)", async () => {
    clockMs = 0;
    const { provider, deps } = mk({ jobTimeoutMs: 60_000 });
    const id = await submit(A, deps, "Roteiro [[mock:hang]]");
    await processCreativeJobs(T0, rd(deps));
    const first = (await jobs(id))[0];
    expect(first.status).toBe("processing");
    await processCreativeJobs(at(30_000), rd(deps));
    expect((await jobs(id))[0].status).toBe("processing");
    await processCreativeJobs(at(5 * 60_000), rd(deps));
    const failed = (await jobs(id))[0];
    expect(failed).toMatchObject({ status: "failed", failureKind: "timeout" });
    expect((await creative(id)).error).toMatch(/demorou mais/i);

    await retryCreative(ctx(A), id, { ...deps, now: at(6 * 60_000) });
    const second = (await jobs(id))[1];
    expect(second.providerJobId).toBe(first.providerJobId);
    expect(second.deadlineAt.getTime()).toBeGreaterThan(at(6 * 60_000).getTime());
    expect(provider.stats.create).toBe(1);
    expect(provider.stats.cancel).toBe(0);
  });

  it("esgotar tentativas de consulta tambem vira timeout", async () => {
    const { deps } = mk({ jobMaxAttempts: 3 });
    const id = await submit(A, deps, "Roteiro [[mock:hang]]");
    for (let i = 0; i < 5; i++) await processCreativeJobs(at(i * 120_000), rd(deps));
    expect((await jobs(id))[0]).toMatchObject({ status: "failed", failureKind: "timeout" });
  });

  it("retry duplo (duplo clique) cria UM so job; submit duplo idem", async () => {
    const { deps } = mk();
    const d = await draft(A, deps, "Roteiro [[mock:fail]]");
    await Promise.all([submitCreative(ctx(A), d.id, deps), submitCreative(ctx(A), d.id, deps)]);
    expect(await jobs(d.id)).toHaveLength(1);
    await processCreativeJobs(T0, rd(deps));
    await processCreativeJobs(at(60_000), rd(deps));
    expect((await creative(d.id)).status).toBe("failed");
    await Promise.all([retryCreative(ctx(A), d.id, deps), retryCreative(ctx(A), d.id, deps), retryCreative(ctx(A), d.id, deps)]);
    expect((await jobs(d.id)).map((j) => j.runNo)).toEqual([1, 2]);
  });
});

describe("download/storage", () => {
  it("falha retentavel ao baixar: job segue processing e conclui depois, com UM unico arquivo", async () => {
    clockMs = 0;
    const { provider, deps } = mk({}, 0);
    const id = await submit(A, deps);
    await processCreativeJobs(T0, rd(deps));
    provider.failNextFetch = true;
    await processCreativeJobs(at(60_000), rd(deps));
    expect((await jobs(id))[0]).toMatchObject({ status: "processing", attempts: 2 });
    await processCreativeJobs(at(180_000), rd(deps));
    const c = await creative(id);
    expect(c.status).toBe("ready");
    expect(provider.stats.create).toBe(1);
    expect(await prisma.storedFile.count({ where: { id: c.videoFileId! } })).toBe(1);
  });

  it("falha de storage (MIME nao permitido) => failed storage; retry reaproveita o job do provedor e conclui com storage correto", async () => {
    clockMs = 0;
    const { provider, deps } = mk({}, 0);
    const badDeps: Deps = { ...deps, storage: { provider: storage, config: sc({ allowedMime: ["image/png"] }) } };
    const id = await submit(A, deps);
    await processCreativeJobs(T0, rd(badDeps));
    await processCreativeJobs(at(60_000), rd(badDeps));
    expect((await jobs(id))[0]).toMatchObject({ status: "failed", failureKind: "storage" });
    expect((await creative(id)).error).toMatch(/salvá-lo/);
    await retryCreative(ctx(A), id, deps);
    await processCreativeJobs(at(120_000), rd(deps));
    expect((await creative(id)).status).toBe("ready");
    expect(provider.stats.create).toBe(1); // sem nova cobranca
  });
});

describe("cancelamento", () => {
  it("cancelar ainda na fila: job canceled, cota devolvida, provedor nunca chamado; runner ignora", async () => {
    const { provider, deps } = mk();
    const id = await submit(A, deps);
    expect((await creative(id)).submittedAt).not.toBeNull();
    await cancelCreative(ctx(A), id, deps);
    expect(await creative(id)).toMatchObject({ status: "canceled", submittedAt: null });
    expect((await jobs(id))[0]).toMatchObject({ status: "canceled", failureKind: "canceled" });
    await processCreativeJobs(T0, rd(deps));
    expect(provider.stats.create).toBe(0);
  });

  it("cancelar em processamento: chama cancel no provedor, mantem a cota, runner descarta", async () => {
    clockMs = 0;
    const { provider, deps } = mk({}, 60_000);
    const id = await submit(A, deps);
    await processCreativeJobs(T0, rd(deps));
    await cancelCreative(ctx(A), id, deps);
    expect(provider.stats.cancel).toBe(1);
    expect(await creative(id)).toMatchObject({ status: "canceled" });
    expect((await creative(id)).submittedAt).not.toBeNull();
    clockMs = 120_000;
    expect((await processCreativeJobs(at(5 * 60_000), rd(deps))).picked).toBe(0);
    expect((await creative(id)).status).toBe("canceled");
  });

  it("cancelamento DURANTE o download/upload: nao vira ready e o blob/metadado e removido", async () => {
    clockMs = 0;
    const { provider, deps } = mk({}, 0);
    const id = await submit(A, deps);
    await processCreativeJobs(T0, rd(deps));
    const orig = provider.fetchVideo.bind(provider);
    provider.fetchVideo = async (jid) => {
      await cancelCreative(ctx(A), id, deps); // usuario cancela enquanto o worker baixa
      return orig(jid);
    };
    const before = await prisma.storedFile.count({ where: { orgId: A.orgId, deletedAt: null } });
    const s = await processCreativeJobs(at(60_000), rd(deps));
    expect(s.succeeded).toBe(0);
    expect((await creative(id)).status).toBe("canceled");
    expect((await jobs(id))[0].status).toBe("canceled");
    expect(await prisma.storedFile.count({ where: { orgId: A.orgId, deletedAt: null } })).toBe(before);
  });

  it("retry de criativo cancelado cria novo job sem reaproveitar o provedor", async () => {
    clockMs = 0;
    const { provider, deps } = mk({}, 60_000);
    const id = await submit(A, deps);
    await processCreativeJobs(T0, rd(deps));
    await cancelCreative(ctx(A), id, deps);
    await retryCreative(ctx(A), id, deps);
    const all = await jobs(id);
    expect(all[1]).toMatchObject({ runNo: 2, providerJobId: null, status: "queued" });
    expect(provider.stats.create).toBe(1);
  });
});

describe("job preso", () => {
  it("processing com lease expirado e retomado (recovered); lease recente e respeitado", async () => {
    clockMs = 0;
    const { deps } = mk({}, 0);
    const id = await submit(A, deps);
    await processCreativeJobs(T0, rd(deps)); // -> processing
    const j = (await jobs(id))[0];
    await prisma.creativeJob.update({ where: { id: j.id }, data: { lockedAt: at(-60_000), nextRunAt: T0 } }); // worker "vivo"
    expect((await processCreativeJobs(T0, rd(deps))).picked).toBe(0);
    await prisma.creativeJob.update({ where: { id: j.id }, data: { lockedAt: at(-(LEASE_MS + 1000)) } }); // worker morreu
    const s = await processCreativeJobs(T0, rd(deps));
    expect(s).toMatchObject({ picked: 1, recovered: 1, succeeded: 1 });
    expect((await creative(id)).status).toBe("ready");
  });

  it("queued SEM providerJobId apos crash entre create e gravar: createVideo repetido devolve o MESMO id (idempotencyKey)", async () => {
    clockMs = 0;
    const { provider, deps } = mk({}, 60_000);
    const id = await submit(A, deps);
    const j = (await jobs(id))[0];
    const crashed = await provider.createVideo({ script: "x", avatarId: "mock-ana", voiceId: "mock-voz-br-f", language: "pt-BR", aspectRatio: "9:16", durationSec: 5, idempotencyKey: j.idempotencyKey });
    await prisma.creativeJob.update({ where: { id: j.id }, data: { lockedAt: at(-(LEASE_MS + 1000)) } });
    await processCreativeJobs(T0, rd(deps));
    expect((await jobs(id))[0].providerJobId).toBe(crashed.providerJobId);
  });

  it("erro inesperado no job solta o lease (nao fica preso) e nao derruba o tick", async () => {
    const { provider, deps } = mk();
    const id = await submit(A, deps);
    vi.spyOn(console, "error").mockImplementation(() => {});
    provider.createVideo = async () => {
      throw new TypeError("bug inesperado com segredo sk-abc123");
    };
    // erro nao-AppError e tratado como retentavel (reagenda); lease liberado
    await expect(processCreativeJobs(T0, rd(deps))).resolves.toMatchObject({ picked: 1 });
    const j = (await jobs(id))[0];
    expect(j.lockedAt).toBeNull();
    expect(j.status).toBe("queued");
    vi.restoreAllMocks();
  });
});

describe("isolamento e gate de org", () => {
  it("org suspensa nao e processada; org B processa sem tocar a A", async () => {
    clockMs = 0;
    const { provider, deps } = mk({}, 0);
    const idA = await submit(A, deps);
    const idB = await submit(B, deps);
    await prisma.organization.update({ where: { id: A.orgId }, data: { status: "suspended" } });
    // limpa pendencias de testes anteriores da org A (suspensa de qualquer forma)
    const s = await processCreativeJobs(T0, rd(deps, { maxJobs: 500 }));
    expect(s.picked).toBeGreaterThanOrEqual(1);
    expect((await jobs(idA))[0].status).toBe("queued");
    expect((await jobs(idB))[0].status).toBe("processing");
    expect((await jobs(idB))[0].orgId).toBe(B.orgId);
    await prisma.organization.update({ where: { id: A.orgId }, data: { status: "active" } });
    void provider;
  });

  it("o video gravado fica sempre sob o prefixo da org dona do criativo", async () => {
    clockMs = 0;
    const { deps } = mk({}, 0);
    const id = await submit(B, deps);
    await processCreativeJobs(T0, rd(deps, { maxJobs: 500 }));
    await processCreativeJobs(at(60_000), rd(deps, { maxJobs: 500 }));
    const c = await creative(id);
    const f = await prisma.storedFile.findUniqueOrThrow({ where: { id: c.videoFileId! } });
    expect(f.orgId).toBe(B.orgId);
    expect(f.blobKey.startsWith(`orgs/${B.orgId}/`)).toBe(true);
  });
});

describe("correcoes pos-QA (SPEC-051a)", () => {
  it("M2: corrida cancel x createRemote — o runner confirma o providerJobId ENTRE a leitura e a escrita do cancel => provider.cancel e chamado (sem orfao)", async () => {
    clockMs = 0;
    const { provider, deps } = mk({}, 0);
    const id = await submit(A, deps);
    const jobId = (await jobs(id))[0].id;
    let created!: () => void;
    const createdP = new Promise<void>((r) => (created = r));
    let release!: () => void;
    const releaseP = new Promise<void>((r) => (release = r));
    const origCreate = provider.createVideo.bind(provider);
    provider.createVideo = async (input) => {
      const r = await origCreate(input);
      created(); // o provedor ja criou; o runner ainda NAO confirmou no banco
      await releaseP;
      return r;
    };
    // injeta a corrida: logo antes da escrita do cancel (creative.updateMany -> canceled), libera o runner e espera a confirmacao dele
    const realTx = prisma.$transaction.bind(prisma) as (fn: (tx: any) => Promise<unknown>, ...a: unknown[]) => Promise<unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const spy = vi.spyOn(prisma, "$transaction").mockImplementation(((fn: unknown, ...rest: unknown[]) => {
      if (typeof fn !== "function") return realTx(fn as never, ...rest);
      return realTx((tx) => {
        const proxy = new Proxy(tx, {
          get(t, k, r) {
            if (k !== "creative") return Reflect.get(t, k, r);
            return new Proxy(t.creative, {
              get(ct, ck, cr) {
                if (ck !== "updateMany") return Reflect.get(ct, ck, cr);
                return async (args: { data?: { status?: string } }) => {
                  if (args?.data?.status === "canceled") {
                    release();
                    for (let i = 0; i < 20; i++) { // espera ate 1 s pela confirmacao do runner (sem o fix ela passa; com o fix o lock a segura)
                      if ((await prisma.creativeJob.findUniqueOrThrow({ where: { id: jobId } })).providerJobId) break;
                      await new Promise((r2) => setTimeout(r2, 50));
                    }
                  }
                  return ct.updateMany(args);
                };
              },
            });
          },
        });
        return (fn as (tx: unknown) => Promise<unknown>)(proxy);
      }, ...rest);
    }) as never);
    try {
      const runnerP = processCreativeJobs(T0, rd(deps));
      await createdP;
      const cancelP = cancelCreative(ctx(A), id, deps);
      await Promise.all([runnerP, cancelP]);
    } finally {
      spy.mockRestore();
    }
    expect((await jobs(id))[0].status).toBe("canceled");
    expect((await creative(id)).status).toBe("canceled");
    expect(provider.stats.create).toBe(1);
    expect(provider.stats.cancel).toBe(1); // sem o fix: 0 (job orfao no provedor)
  });

  it("M2: cancel de job ja confirmado no provedor chama provider.cancel e mantem a cota", async () => {
    clockMs = 0;
    const { provider, deps } = mk({}, 0);
    const id = await submit(A, deps);
    await processCreativeJobs(T0, rd(deps));
    await cancelCreative(ctx(A), id, deps);
    expect(provider.stats.cancel).toBe(1);
    expect((await creative(id)).submittedAt).not.toBeNull();
  });

  it("B2: criador removido da org => o upload usa um owner da org (uploadedByUserId) e o job conclui", async () => {
    clockMs = 0;
    const { deps } = mk({}, 0);
    const id = await submit(A, deps);
    await prisma.creative.update({ where: { id }, data: { createdBy: "00000000-0000-4000-8000-000000000000" } }); // criador inexistente (sem FK)
    await processCreativeJobs(T0, rd(deps));
    clockMs = 5000;
    const s = await processCreativeJobs(at(2 * 60_000), rd(deps));
    expect(s.succeeded).toBe(1);
    const c = await creative(id);
    expect(c.status).toBe("ready");
    const f = await prisma.storedFile.findUniqueOrThrow({ where: { id: c.videoFileId! } });
    expect(f.uploadedByUserId).toBe(A.userId);
  });

  it("B3: dois processCreativeJobs simultaneos no mesmo job — so um claim vence (provedor chamado 1x)", async () => {
    clockMs = 0;
    const { provider, deps } = mk({}, 0);
    const id = await submit(A, deps);
    const [s1, s2] = await Promise.all([processCreativeJobs(T0, rd(deps)), processCreativeJobs(T0, rd(deps))]);
    expect(s1.picked + s2.picked).toBe(1);
    expect(s1.skipped + s2.skipped).toBe(1);
    expect(provider.stats.create).toBe(1);
    expect((await jobs(id))[0]).toMatchObject({ status: "processing", attempts: 1 });
  });

  it("B4: stream acima de STORAGE_MAX_FILE_BYTES => failed/storage, sem arquivo gravado", async () => {
    clockMs = 0;
    const { deps } = mk({}, 0);
    deps.storage = { provider: storage, config: sc({ maxFileBytes: 1000 }) };
    const id = await submit(A, deps);
    const before = await prisma.storedFile.count({ where: { orgId: A.orgId, deletedAt: null } });
    await processCreativeJobs(T0, rd(deps));
    clockMs = 5000;
    await processCreativeJobs(at(2 * 60_000), rd(deps));
    expect((await jobs(id))[0]).toMatchObject({ status: "failed", failureKind: "storage" });
    expect((await creative(id)).status).toBe("failed");
    expect(await prisma.storedFile.count({ where: { orgId: A.orgId, deletedAt: null } })).toBe(before);
  });

  it("timeout de inatividade no download: stream travado nao prende o job — reagenda (retentavel) e fecha o stream", async () => {
    clockMs = 0;
    const { provider, deps } = mk({}, 0);
    const id = await submit(A, deps);
    await processCreativeJobs(T0, rd(deps));
    let closed = false;
    provider.fetchVideo = async () => ({
      contentType: "video/mp4",
      body: { [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<Uint8Array>>(() => {}), return: async () => { closed = true; return { done: true, value: undefined }; } }) },
    });
    const s = await processCreativeJobs(at(2 * 60_000), rd(deps, { downloadIdleMs: 50 }));
    expect(s.advanced).toBe(1);
    expect(closed).toBe(true);
    expect((await jobs(id))[0]).toMatchObject({ status: "processing", attempts: 2, lockedAt: null });
  });
});
