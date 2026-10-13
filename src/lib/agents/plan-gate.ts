import { prisma } from "@/lib/prisma";
import { agentRoleFeature, getEntitlements, hasFeature, isCostlyBlocked, type Entitlements } from "@/lib/billing/entitlements";
import { monthStart } from "./budget";

/**
 * SPEC-069b — defesa em profundidade dos agentes no tick/runner (D-069-9/10). Funcoes PURAS + 1 helper de banco, sem comparar `plan.key`:
 * tudo sai de `Entitlements` (plano + override + estado da assinatura). Nada e apagado: o que nao cabe no plano fica PARADO (tarefas
 * continuam `queued`, agente continua `active`) e volta a rodar no upgrade/regularizacao.
 */
export interface ActiveAgentRef {
  id: string;
  role: string;
}

/**
 * Agentes DA ORG que podem rodar agora: org nao bloqueada/pausada (IA e dinheiro: fail-closed), papel liberado pelo plano e dentro de
 * `maxActiveAgents` (os mais antigos tem prioridade). `activeAgents` DEVE vir ordenado por `createdAt, id`.
 */
export function runnableAgentIds(ent: Entitlements, activeAgents: readonly ActiveAgentRef[]): Set<string> {
  if (isCostlyBlocked(ent)) return new Set();
  const limit = ent.limits.maxActiveAgents;
  const allowed = activeAgents.filter((a) => hasFeature(ent, agentRoleFeature(a.role)));
  return new Set((limit === null ? allowed : allowed.slice(0, Math.max(0, limit))).map((a) => a.id));
}

/** Agentes ativos da org, na ordem de prioridade (mais antigo primeiro). */
export async function listActiveAgents(orgId: string): Promise<ActiveAgentRef[]> {
  return prisma.agent.findMany({ where: { orgId, active: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, role: true } });
}

/** Gasto de IA do MES da ORG (micro-USD), somando todos os agentes e simulacoes da org (isolado por org). */
export async function monthlyOrgSpend(orgId: string, now: Date): Promise<number> {
  const r = await prisma.agentRun.aggregate({ _sum: { costMicros: true }, where: { createdAt: { gte: monthStart(now) }, agent: { orgId } } });
  return r._sum.costMicros ?? 0;
}

/** Resolve (1 query de plano + 1 de agentes por org) os agentes executaveis de cada org com tarefa na fila. Sem N+1 por tarefa. */
export async function resolveRunnableAgents(orgIds: readonly string[], now: Date): Promise<string[]> {
  const out: string[] = [];
  for (const orgId of orgIds) {
    const ent = await getEntitlements(prisma, orgId, now);
    if (isCostlyBlocked(ent)) continue;
    out.push(...runnableAgentIds(ent, await listActiveAgents(orgId)));
  }
  return out;
}
