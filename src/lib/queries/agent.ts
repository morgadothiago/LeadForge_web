import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { requireAdmin } from "@/lib/auth/require-admin";

/** Leituras para a UI de agentes/aprovações (o frontend consome; sem segredos, sem telefone/e-mail). */
export async function listAgents() {
  await requireAdmin();
  return prisma.agent.findMany({ orderBy: [{ role: "asc" }, { createdAt: "asc" }], include: { knowledge: { select: { id: true, title: true, version: true } } } });
}

export async function getAgentSettings() {
  await requireAdmin();
  return (await prisma.agentSettings.findUnique({ where: { id: "global" } })) ?? { id: "global", killSwitch: true, monthlyBudgetCents: null };
}

export async function listDrafts(status: "pending" | "all" = "pending", take = 100) {
  await requireUser();
  return prisma.draft.findMany({
    where: status === "pending" ? { status: "pending" } : {},
    orderBy: { createdAt: "asc" },
    take,
    include: { lead: { select: { id: true, name: true, company: true } }, agentRun: { select: { id: true, agent: { select: { id: true, name: true, role: true } }, costMicros: true } } },
  });
}

export async function listAgentRuns(agentId?: string, take = 100) {
  await requireAdmin();
  return prisma.agentRun.findMany({
    where: agentId ? { agentId } : {}, orderBy: { createdAt: "desc" }, take,
    select: { id: true, agentId: true, leadId: true, trigger: true, status: true, model: true, tokensIn: true, tokensOut: true, costMicros: true, latencyMs: true, guardrailsViolated: true, error: true, createdAt: true },
  });
}

export async function listNeedsHuman(take = 100) {
  await requireUser();
  return prisma.lead.findMany({ where: { needsHuman: true }, orderBy: { handoffAt: "desc" }, take, select: { id: true, name: true, company: true, handoffAt: true, handoffReason: true } });
}
