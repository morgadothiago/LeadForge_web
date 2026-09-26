import { prisma } from "@/lib/prisma";
import { safeErrorForLog } from "@/lib/errors";
import { runAgentTask, type RunOutcome } from "./run-agent";
import { expireOldDrafts } from "./drafts";
import { purgeAgentData } from "./retention";
import type { LlmProvider } from "./provider";

export const QUEUE_BATCH = 10;
export const QUEUE_TIME_BUDGET_MS = 15_000;
const STALE_RUNNING_MS = 10 * 60_000;

/** Enfileira tarefa de agente. Barato e SEM chamar o LLM (o webhook responde em <1 s). Idempotente por (lead, passo, gatilho). */
export async function enqueueAgentRun(input: { agentId: string; leadId: string; stepId?: string | null; trigger: string }, db: Pick<typeof prisma, "agentRun"> = prisma): Promise<boolean> {
  try {
    await db.agentRun.create({ data: { agentId: input.agentId, leadId: input.leadId, stepId: input.stepId ?? null, trigger: input.trigger, status: "queued" } });
    return true;
  } catch (e) {
    if (typeof e === "object" && e && (e as { code?: string }).code === "P2002") return false;
    throw e;
  }
}

/** Agente ativo, com teto definido e kill switch da ORG do agente desligado (SPEC-030: AgentSettings é por-org). */
export async function isAgentAvailable(agentId: string, db: Pick<typeof prisma, "agent" | "agentSettings"> = prisma): Promise<boolean> {
  const a = await db.agent.findUnique({ where: { id: agentId }, select: { active: true, monthlyBudgetCents: true, orgId: true } });
  if (!a) return false;
  const s = await db.agentSettings.findUnique({ where: { orgId: a.orgId } });
  if (s?.killSwitch !== false) return false;
  return !!a.active && a.monthlyBudgetCents !== null;
}

/** Agente Closer ativo (e sistema ligado) para tarefa inbound DESTA org; null = nada a fazer. */
export async function findActiveCloser(orgId: string, db: Pick<typeof prisma, "agent" | "agentSettings"> = prisma): Promise<{ id: string } | null> {
  const s = await db.agentSettings.findUnique({ where: { orgId } });
  if (s?.killSwitch !== false) return null;
  return db.agent.findFirst({ where: { orgId, role: "closer", active: true }, select: { id: true }, orderBy: { createdAt: "asc" } });
}

export interface QueueSummary { processed: number; outcomes: Record<string, number>; expired: number; purged: number }

/** Processa a fila (Fila C do scheduler). Reserva atômica queued->running; falha isolada por tarefa. */
export async function processAgentQueue(opts: { now?: Date; provider?: LlmProvider; limit?: number; budgetMs?: number } = {}): Promise<QueueSummary> {
  const now = opts.now ?? new Date();
  const t0 = Date.now();
  const outcomes: Record<string, number> = {};
  let processed = 0;
  await prisma.agentRun.updateMany({ where: { status: "running", createdAt: { lt: new Date(now.getTime() - STALE_RUNNING_MS) } }, data: { status: "queued" } });
  const rows = await prisma.agentRun.findMany({ where: { status: "queued", agent: { active: true } }, orderBy: { createdAt: "asc" }, take: opts.limit ?? QUEUE_BATCH, select: { id: true } });
  for (const r of rows) {
    if (Date.now() - t0 > (opts.budgetMs ?? QUEUE_TIME_BUDGET_MS)) break;
    const claim = await prisma.agentRun.updateMany({ where: { id: r.id, status: "queued" }, data: { status: "running" } });
    if (!claim.count) continue;
    let out: RunOutcome | null = null;
    try {
      out = await runAgentTask({ runId: r.id, now, provider: opts.provider });
    } catch (e) {
      console.error("[agents] tarefa falhou:", safeErrorForLog(e));
      await prisma.agentRun.update({ where: { id: r.id }, data: { status: "failed", error: "erro_interno", processedAt: new Date() } }).catch(() => {});
    }
    processed++;
    const k = out ? (out.status === "skipped" || out.status === "deferred" ? `${out.status}:${"reason" in out ? out.reason : ""}` : out.status) : "failed";
    outcomes[k] = (outcomes[k] ?? 0) + 1;
    if (out?.status === "deferred") break; // orçamento/limite diário: para a rodada (evita laço)
  }
  const expired = await expireOldDrafts(now).catch(() => 0);
  const purged = await purgeAgentData(now).catch(() => 0);
  return { processed, outcomes, expired, purged };
}
