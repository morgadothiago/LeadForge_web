import { AppError, safeErrorForLog } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";
import { getEntitlements, isCostlyBlocked, type Entitlements } from "@/lib/billing/entitlements";
import { sanitizeFileName } from "@/lib/storage/keys";
import { deleteFile, uploadFile } from "@/lib/storage/service";
import { getCreativeConfig, type CreativeConfig } from "./config";
import { getAvatarVideoProvider } from "./factory";
import { FAILURE_MESSAGE } from "./messages";
import type { AvatarVideoProvider, ProviderVideoStream } from "./provider";
import type { CreativeFailureKind } from "./types";
import type { Deps } from "./service";

/**
 * SPEC-051 (D-051-5) — executor dos jobs por POLLING, chamado pelo tick do scheduler (`/api/cron/tick`, SPEC-013). Sem webhook.
 *
 * Maquina de estados do CreativeJob: `queued -> processing -> succeeded | failed | canceled`.
 *  - `queued` sem `providerJobId`: cria no provedor (idempotente por `idempotencyKey`) -> `processing`.
 *  - `processing`: `getStatus`; em andamento reagenda com backoff exponencial + jitter; `done` baixa o video por STREAM
 *    e grava via SPEC-050 (`uploadFile`, category=creative); `failed` => falha `provider_failed`.
 *  - Limites: `deadlineAt` (timeout total) e `attempts` (CREATIVE_JOB_MAX_ATTEMPTS) => falha `timeout`.
 *  - Job preso: o worker toma um lease (`lockedAt`); se o processo morrer, o lease expira (LEASE_MS) e outro tick retoma.
 *    Job com `providerJobId` nulo apos crash e retomado chamando `createVideo` de novo (mesma `idempotencyKey` => mesmo job).
 *  - Cancelamento/retry concorrentes: toda transicao e compare-and-set no status do job; quem perde descarta o trabalho
 *    (blob recem-gravado e removido; job criado no provedor e cancelado best-effort).
 * Orgs suspensas/canceladas nao sao processadas (nao gasta custo de provedor).
 */
export const LEASE_MS = 5 * 60_000;
export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_CAP_MS = 60_000;
export const DOWNLOAD_IDLE_MS = 30_000;
const DEFAULT_MAX_JOBS = 20;
const DEFAULT_TIME_BUDGET_MS = 20_000;

export interface RunnerDeps extends Omit<Deps, "now"> {
  /** Relogio real (orcamento de tempo). */
  clock?: () => number;
  random?: () => number;
  maxJobs?: number;
  timeBudgetMs?: number;
  leaseMs?: number;
  /** Timeout de INATIVIDADE do stream de download (ms sem receber chunk). Default 30 s. */
  downloadIdleMs?: number;
}
export interface RunnerSummary {
  picked: number;
  succeeded: number;
  failed: number;
  advanced: number;
  recovered: number;
  skipped: number;
}

export function backoffMs(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.min(Math.max(attempts, 0), 6));
  return Math.round(base * (0.8 + random() * 0.4)); // jitter +-20%
}

const sanitizeRaw = (s: string | undefined): string | null => (s ? s.replace(/[^\w .:-]/g, "").slice(0, 60) : null);

interface JobRec {
  id: string;
  orgId: string;
  creativeId: string;
  provider: string;
  providerJobId: string | null;
  attempts: number;
  deadlineAt: Date;
  idempotencyKey: string;
  startedAt: Date | null;
}
const ACTIVE = ["queued", "processing"] as const;

class Lost extends Error {} // job cancelado/alterado por outro caminho: descartar

export async function processCreativeJobs(now: Date, deps: RunnerDeps = {}): Promise<RunnerSummary> {
  const sum: RunnerSummary = { picked: 0, succeeded: 0, failed: 0, advanced: 0, recovered: 0, skipped: 0 };
  let config: CreativeConfig;
  let provider: AvatarVideoProvider;
  try {
    config = deps.config ?? getCreativeConfig();
    provider = deps.provider ?? getAvatarVideoProvider();
  } catch (e) {
    console.error("[creatives] indisponível:", safeErrorForLog(e));
    return sum; // sem provedor configurado: jobs aguardam (nao falha em massa)
  }
  const clock = deps.clock ?? Date.now;
  const t0 = clock();
  const budget = deps.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const lease = deps.leaseMs ?? LEASE_MS;
  const leaseCutoff = new Date(now.getTime() - lease);

  // Selecao cross-tenant INTENCIONAL (como o scheduler): so ids; toda escrita abaixo passa por scopedPrisma(job.orgId) / orgId explicito.
  const due = await prisma.creativeJob.findMany({
    where: { status: { in: [...ACTIVE] }, nextRunAt: { lte: now }, org: { status: "active" }, OR: [{ lockedAt: null }, { lockedAt: { lt: leaseCutoff } }] },
    orderBy: { nextRunAt: "asc" },
    take: deps.maxJobs ?? DEFAULT_MAX_JOBS,
    select: { id: true, orgId: true, creativeId: true, provider: true, providerJobId: true, attempts: true, deadlineAt: true, idempotencyKey: true, startedAt: true, lockedAt: true },
  });

  // SPEC-069b: defesa em profundidade. Gerar video no provedor custa dinheiro: plano ilegivel/erro, org bloqueada, `past_due` ou plano sem criativos
  // (limite 0) => NAO cria job no provedor. O job fica `queued` (nada e apagado; reagenda) e segue no upgrade/regularizacao ou falha pelo prazo. Plano resolvido 1x por org.
  const planByOrg = new Map<string, Entitlements>();
  const planOf = async (orgId: string): Promise<Entitlements> => {
    const hit = planByOrg.get(orgId);
    if (hit) return hit;
    const ent = await getEntitlements(prisma, orgId, now);
    planByOrg.set(orgId, ent);
    return ent;
  };
  for (const row of due) {
    if (clock() - t0 > budget) break;
    const { lockedAt, ...job } = row;
    // claim por compare-and-set (lease)
    const claimed = await scopedPrisma(job.orgId).creativeJob.updateMany({
      where: { id: job.id, status: { in: [...ACTIVE] }, OR: [{ lockedAt: null }, { lockedAt: { lt: leaseCutoff } }] },
      data: { lockedAt: now },
    });
    if (claimed.count !== 1) {
      sum.skipped++;
      continue;
    }
    // SPEC-069b: o plano e checado DEPOIS do claim (a janela entre ler `due` e reivindicar nao pode aumentar); se bloqueado, solta o lease e reagenda.
    if (!job.providerJobId) {
      const ent = await planOf(job.orgId);
      if (isCostlyBlocked(ent) || ent.limits.maxCreativesPerMonth === 0) {
        await prisma.creativeJob.updateMany({ where: { id: job.id, status: "queued", providerJobId: null }, data: { lockedAt: null, nextRunAt: new Date(now.getTime() + backoffMs(Math.max(1, job.attempts + 1), deps.random)) } });
        sum.skipped++;
        continue;
      }
    }
    sum.picked++;
    if (lockedAt) sum.recovered++;
    try {
      const r = await step(job, now, provider, config, deps);
      sum[r]++;
    } catch (e) {
      if (e instanceof Lost) {
        sum.skipped++;
        continue;
      }
      // erro inesperado (bug/DB): solta o lease para o proximo tick tentar de novo; nunca derruba o tick
      console.error("[creatives] erro inesperado no job:", safeErrorForLog(e));
      await scopedPrisma(job.orgId).creativeJob.updateMany({ where: { id: job.id, status: { in: [...ACTIVE] } }, data: { lockedAt: null, nextRunAt: new Date(now.getTime() + backoffMs(job.attempts + 1, deps.random)) } }).catch(() => {});
    }
  }
  return sum;
}

type Outcome = "succeeded" | "failed" | "advanced";

async function step(job: JobRec, now: Date, provider: AvatarVideoProvider, config: CreativeConfig, deps: RunnerDeps): Promise<Outcome> {
  if (job.provider !== provider.name) return fail(job, "provider_unavailable", now);
  if (now.getTime() > job.deadlineAt.getTime()) return fail(job, "timeout", now);

  if (!job.providerJobId) return createRemote(job, now, provider, config, deps);

  let st;
  try {
    st = await provider.getStatus(job.providerJobId);
  } catch (e) {
    return handleProviderError(job, e, now, config, deps, "provider_unavailable");
  }
  if (st.state === "failed") return fail(job, "provider_failed", now, sanitizeRaw(st.rawStatus));
  if (st.state === "processing") {
    const attempts = job.attempts + 1;
    if (attempts >= config.jobMaxAttempts) return fail(job, "timeout", now);
    await patch(job, { attempts, lastPolledAt: now, progressPct: st.progressPct ?? null, rawStatus: sanitizeRaw(st.rawStatus), nextRunAt: new Date(now.getTime() + backoffMs(attempts, deps.random)), lockedAt: null });
    return "advanced";
  }
  return finalize(job, now, provider, config, deps, st);
}

async function createRemote(job: JobRec, now: Date, provider: AvatarVideoProvider, config: CreativeConfig, deps: RunnerDeps): Promise<Outcome> {
  const c = await scopedPrisma(job.orgId).creative.findFirst({ where: { id: job.creativeId, deletedAt: null }, select: { script: true, avatarRef: true, voiceRef: true, language: true, aspectRatio: true, durationSec: true } });
  if (!c) return fail(job, "provider_rejected", now);
  let remote: { providerJobId: string };
  try {
    remote = await provider.createVideo({ script: c.script, avatarId: c.avatarRef, voiceId: c.voiceRef, language: c.language, aspectRatio: c.aspectRatio, durationSec: c.durationSec ?? config.maxDurationSec, idempotencyKey: job.idempotencyKey });
  } catch (e) {
    return handleProviderError(job, e, now, config, deps, "provider_rejected");
  }
  const attempts = job.attempts + 1;
  const ok = await raw$(async (tx) => {
    const r = await tx.creativeJob.updateMany({ where: { id: job.id, orgId: job.orgId, status: { in: [...ACTIVE] } }, data: { status: "processing", providerJobId: remote.providerJobId, startedAt: job.startedAt ?? now, attempts, lastPolledAt: now, nextRunAt: new Date(now.getTime() + backoffMs(0, deps.random)), lockedAt: null } });
    if (r.count !== 1) return false;
    await tx.creative.updateMany({ where: { id: job.creativeId, orgId: job.orgId, status: { in: [...ACTIVE] } }, data: { status: "processing" } });
    return true;
  });
  if (!ok) {
    await provider.cancel?.(remote.providerJobId).catch(() => {}); // perdeu a corrida (cancelado): nao deixa job orfao no provedor
    throw new Lost();
  }
  return "advanced";
}

/** Erro do provedor: retentavel => reagenda com backoff (ate o limite de tentativas); senao falha. */
async function handleProviderError(job: JobRec, e: unknown, now: Date, config: CreativeConfig, deps: RunnerDeps, nonRetryableKind: CreativeFailureKind): Promise<Outcome> {
  console.error("[creatives] erro do provedor:", safeErrorForLog(e));
  const retryable = e instanceof AppError ? e.retryable : true;
  const attempts = job.attempts + 1;
  if (!retryable) return fail(job, nonRetryableKind, now);
  if (attempts >= config.jobMaxAttempts) return fail(job, "provider_unavailable", now);
  const wait = e instanceof AppError && e.retryAfterSeconds ? Math.max(backoffMs(attempts, deps.random), e.retryAfterSeconds * 1000) : backoffMs(attempts, deps.random);
  await patch(job, { attempts, lastPolledAt: now, nextRunAt: new Date(now.getTime() + wait), lockedAt: null });
  return "advanced";
}

async function finalize(job: JobRec, now: Date, provider: AvatarVideoProvider, config: CreativeConfig, deps: RunnerDeps, st: { durationSec?: number; costCents?: number; rawStatus?: string }): Promise<Outcome> {
  const db = scopedPrisma(job.orgId);
  const creative = await db.creative.findFirst({ where: { id: job.creativeId, deletedAt: null }, select: { title: true, createdBy: true } });
  if (!creative) throw new Lost();
  let sourceFailed = false;
  let video: ProviderVideoStream;
  try {
    video = await provider.fetchVideo(job.providerJobId!);
  } catch (e) {
    return handleProviderError(job, e, now, config, deps, "download");
  }
  const idleMs = deps.downloadIdleMs ?? DOWNLOAD_IDLE_MS;
  async function* watched(): AsyncGenerator<Uint8Array> {
    const it = video.body[Symbol.asyncIterator]();
    try {
      for (;;) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const idle = new Promise<never>((_, rej) => {
          timer = setTimeout(() => rej(new AppError({ code: "network", userMessage: "O provedor parou de enviar o vídeo.", retryable: true })), idleMs);
        });
        let r: IteratorResult<Uint8Array>;
        try {
          r = await Promise.race([it.next(), idle]);
        } finally {
          clearTimeout(timer);
        }
        if (r.done) return;
        yield r.value;
      }
    } catch (err) {
      sourceFailed = true; // falha de leitura do provedor (nao do storage)
      throw err;
    } finally {
      await it.return?.().catch(() => {}); // fecha a conexao do provedor (timeout/abort)
    }
  }
  const uploader = await resolveUploader(job.orgId, creative.createdBy);
  // Lease heartbeat: upload longo nao pode deixar o lease expirar e outro tick refazer o mesmo job.
  const startClock = (deps.clock ?? Date.now)();
  const heartbeat = setInterval(() => {
    const t = new Date(now.getTime() + ((deps.clock ?? Date.now)() - startClock));
    void scopedPrisma(job.orgId).creativeJob.updateMany({ where: { id: job.id, status: { in: [...ACTIVE] } }, data: { lockedAt: t } }).catch(() => {});
  }, Math.max(1_000, Math.floor((deps.leaseMs ?? LEASE_MS) / 3)));
  heartbeat.unref?.();
  let file;
  try {
    file = await uploadFile({ orgId: job.orgId, userId: uploader }, { category: "creative", fileName: `${sanitizeFileName(creative.title).replace(/\.[^.]*$/, "") || "criativo"}.mp4`, contentType: video.contentType, body: watched() }, deps.storage ?? {});
  } catch (e) {
    console.error("[creatives] falha ao salvar o video:", safeErrorForLog(e));
    if (sourceFailed) {
      const retryable = e instanceof AppError ? e.retryable : true;
      return retryable ? handleProviderError(job, e, now, config, deps, "download") : fail(job, "download", now);
    }
    return fail(job, "storage", now);
  } finally {
    clearInterval(heartbeat);
  }
  const ok = await raw$(async (tx) => {
    const r = await tx.creativeJob.updateMany({ where: { id: job.id, orgId: job.orgId, status: { in: [...ACTIVE] } }, data: { status: "succeeded", finishedAt: now, lockedAt: null, progressPct: 100, rawStatus: sanitizeRaw(st.rawStatus), costActualCents: st.costCents ?? null, lastPolledAt: now, attempts: job.attempts + 1 } });
    if (r.count !== 1) return false;
    await tx.creative.updateMany({ where: { id: job.creativeId, orgId: job.orgId, deletedAt: null }, data: { status: "ready", videoFileId: file.id, error: null, ...(st.durationSec ? { durationSec: Math.ceil(st.durationSec) } : {}) } });
    return true;
  });
  if (!ok) {
    await deleteFile(job.orgId, file.id, deps.storage ?? {}).catch(() => {}); // cancelado durante o upload: nao deixa blob/metadado orfao
    throw new Lost();
  }
  return "succeeded";
}

/** B2: `Creative.createdBy` nao tem FK. Se o criador nao e mais membro/nao existe, o upload (FK de `uploadedByUserId`) usa um owner da org. */
async function resolveUploader(orgId: string, createdBy: string): Promise<string> {
  const own = await prisma.membership.findUnique({ where: { userId_orgId: { userId: createdBy, orgId } }, select: { userId: true } });
  if (own) return createdBy;
  const owner = await prisma.membership.findFirst({ where: { orgId, orgRole: "owner" }, orderBy: { createdAt: "asc" }, select: { userId: true } });
  return owner?.userId ?? createdBy;
}

async function fail(job: JobRec, kind: CreativeFailureKind, now: Date, rawStatus?: string | null): Promise<Outcome> {
  const msg = FAILURE_MESSAGE[kind];
  const ok = await raw$(async (tx) => {
    const r = await tx.creativeJob.updateMany({ where: { id: job.id, orgId: job.orgId, status: { in: [...ACTIVE] } }, data: { status: "failed", failureKind: kind, errorMessage: msg, finishedAt: now, lockedAt: null, ...(rawStatus ? { rawStatus } : {}) } });
    if (r.count !== 1) return false;
    await tx.creative.updateMany({ where: { id: job.creativeId, orgId: job.orgId, status: { in: [...ACTIVE] } }, data: { status: "failed", error: msg } });
    return true;
  });
  if (!ok) throw new Lost();
  return "failed";
}

async function patch(job: JobRec, data: Record<string, unknown>): Promise<void> {
  const r = await scopedPrisma(job.orgId).creativeJob.updateMany({ where: { id: job.id, status: { in: [...ACTIVE] } }, data });
  if (r.count !== 1) throw new Lost();
}

const raw$ = <T>(fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>): Promise<T> => prisma.$transaction(fn);
