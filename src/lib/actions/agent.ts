"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { requireAdmin } from "@/lib/auth/require-admin";
import { DEFAULT_DISCLOSURE } from "@/lib/agents/types";
import { simulateAgent, type SimulationResult } from "@/lib/agents/simulate";
import { dispatchDraft, rejectDraft } from "@/lib/agents/drafts";
import { stopAgentOnManualReply } from "@/lib/agents/lead-state";
import { listAgentRuns } from "@/lib/queries/agent";
import { monthlySpend } from "@/lib/agents/run-agent";
import { budgetState, type BudgetState } from "@/lib/agents/budget";
import {
  approveDraftSchema, bulkApproveSchema, createAgentSchema, globalSettingsSchema, idSchema, knowledgeSchema,
  rejectDraftSchema, setActiveSchema, setAutonomySchema, simulateSchema, updateAgentSchema,
} from "@/lib/schemas/agent";
import { failure, formError, safeAction, success, zodErrors, type ActionResult } from "./result";

const revalidate = (): void => {
  revalidatePath("/configuracoes/agentes");
  revalidatePath("/aprovacoes");
};

/** Cria agente (sempre INATIVO, autonomia `draft`). Closer nasce com aviso de IA ligado (D27). */
export async function createAgent(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const actor = await requireUser();
    await requireAdmin();
    const parsed = createAgentSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const d = parsed.data;
    const closer = d.role === "closer";
    const a = await prisma.agent.create({
      data: {
        ...d,
        escalationRules: d.escalationRules,
        active: false, autonomy: "draft",
        disclosureEnabled: d.disclosureEnabled ?? closer,
        disclosureText: d.disclosureText ?? (closer ? DEFAULT_DISCLOSURE : null),
        updatedBy: actor.id,
      },
      select: { id: true },
    });
    revalidate();
    return success(a);
  });
}

export async function updateAgent(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const actor = await requireUser();
    await requireAdmin();
    const parsed = updateAgentSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { id, ...rest } = parsed.data;
    const cur = await prisma.agent.findUnique({ where: { id }, select: { role: true, autonomy: true, disclosureEnabled: true } });
    if (!cur) return formError("Agente não encontrado.");
    // Desligar o aviso de IA num Closer sampled/auto derruba a confirmação (voltaria a rascunho no runtime).
    const closerAutoOff = cur.role === "closer" && rest.disclosureEnabled === false && cur.autonomy !== "draft";
    await prisma.agent.update({ where: { id }, data: { ...rest, ...(closerAutoOff ? { autonomy: "draft", autoConfirmedAt: null } : {}), promptVersion: { increment: 1 }, updatedBy: actor.id } });
    revalidate();
    return success({ id });
  });
}

/** Ativar exige teto de gasto definido (padrão: agentes DESLIGADOS até haver chave e teto). */
export async function setAgentActive(input: unknown): Promise<ActionResult<{ id: string; active: boolean }>> {
  return safeAction(async () => {
    const actor = await requireUser();
    await requireAdmin();
    const parsed = setActiveSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { id, active } = parsed.data;
    const a = await prisma.agent.findUnique({ where: { id }, select: { monthlyBudgetCents: true } });
    if (!a) return formError("Agente não encontrado.");
    if (active && !a.monthlyBudgetCents) return failure({ monthlyBudgetCents: ["Defina o teto de gasto mensal antes de ativar."] });
    await prisma.agent.update({ where: { id }, data: { active, updatedBy: actor.id } });
    revalidate();
    return success({ id, active });
  });
}

export async function setAgentAutonomy(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const actor = await requireUser();
    await requireAdmin();
    const parsed = setAutonomySchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { id, autonomy, confirmAuto, acknowledgeRisk } = parsed.data;
    const a = await prisma.agent.findUnique({ where: { id }, select: { role: true, disclosureEnabled: true } });
    if (!a) return formError("Agente não encontrado.");
    let autoConfirmedAt: Date | null = null;
    if (a.role === "closer" && autonomy !== "draft") {
      if (!a.disclosureEnabled) return formError("Ligue o aviso de IA antes de dar autonomia ao Closer.");
      if (!confirmAuto || !acknowledgeRisk) return formError("Confirme explicitamente a autonomia e o risco de banimento/LGPD para o Closer.");
      autoConfirmedAt = new Date();
    }
    await prisma.agent.update({ where: { id }, data: { autonomy, autoConfirmedAt, updatedBy: actor.id } });
    revalidate();
    return success({ id });
  });
}

/** Kill switch global (liga = agentes parados) e teto mensal global. */
export async function updateAgentSettings(input: unknown): Promise<ActionResult<{ killSwitch: boolean }>> {
  return safeAction(async () => {
    const actor = await requireUser();
    await requireAdmin();
    const parsed = globalSettingsSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const s = await prisma.agentSettings.upsert({
      where: { id: "global" },
      create: { id: "global", ...parsed.data, updatedBy: actor.id },
      update: { ...parsed.data, updatedBy: actor.id },
    });
    revalidate();
    return success({ killSwitch: s.killSwitch });
  });
}

export async function saveKnowledge(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    await requireUser();
    await requireAdmin();
    const parsed = knowledgeSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { id, ...data } = parsed.data;
    const k = id
      ? await prisma.knowledgeDocument.update({ where: { id }, data: { ...data, version: { increment: 1 } }, select: { id: true } })
      : await prisma.knowledgeDocument.create({ data, select: { id: true } });
    revalidate();
    return success(k);
  });
}

export async function deleteKnowledge(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    await requireUser();
    await requireAdmin();
    const parsed = idSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    await prisma.knowledgeDocument.delete({ where: { id: parsed.data.id } });
    revalidate();
    return success({ id: parsed.data.id });
  });
}

export async function simulateAgentAction(input: unknown): Promise<ActionResult<SimulationResult>> {
  return safeAction(async () => {
    await requireUser();
    await requireAdmin();
    const parsed = simulateSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    return success(await simulateAgent(parsed.data));
  });
}

export interface AgentUsage { agentId: string; spentCents: number; budgetCents: number | null; state: BudgetState }
export async function getAgentUsage(input: unknown): Promise<ActionResult<AgentUsage>> {
  return safeAction(async () => {
    await requireUser();
    const parsed = idSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const a = await prisma.agent.findUnique({ where: { id: parsed.data.id }, select: { monthlyBudgetCents: true } });
    if (!a) return formError("Agente não encontrado.");
    const spent = await monthlySpend(parsed.data.id, new Date());
    return success({ agentId: parsed.data.id, spentCents: Math.round(spent / 10_000), budgetCents: a.monthlyBudgetCents, state: budgetState(spent, a.monthlyBudgetCents) });
  });
}

export interface AgentRunView { id: string; status: string; trigger: string; model: string | null; costMicros: number; latencyMs: number | null; guardrailsViolated: string[]; error: string | null; createdAt: string }
/** Histórico de execuções (admin): custo e guardrails/motivo por execução. Limitado a 50. */
export async function getAgentRuns(input: unknown): Promise<ActionResult<AgentRunView[]>> {
  return safeAction(async () => {
    await requireUser();
    await requireAdmin();
    const parsed = idSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const rows = await listAgentRuns(parsed.data.id, 50);
    return success(rows.map((r) => ({ id: r.id, status: r.status, trigger: String(r.trigger), model: r.model, costMicros: Number(r.costMicros), latencyMs: r.latencyMs, guardrailsViolated: r.guardrailsViolated, error: r.error, createdAt: r.createdAt.toISOString() })));
  });
}

// ---------- Aprovações (qualquer usuário autenticado) ----------

export async function approveDraft(input: unknown): Promise<ActionResult<{ status: string; reason?: string }>> {
  return safeAction(async () => {
    const actor = await requireUser();
    const parsed = approveDraftSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const r = await dispatchDraft(parsed.data.id, { reviewer: actor.id, editedBody: parsed.data.editedBody });
    revalidate();
    return success(r.status === "blocked" ? { status: "blocked", reason: r.reason } : { status: r.status });
  });
}

export async function rejectDraftAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const actor = await requireUser();
    const parsed = rejectDraftSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    if (!(await rejectDraft(parsed.data.id, actor.id, parsed.data.reason))) return formError("Este rascunho já foi tratado.");
    revalidate();
    return success({ id: parsed.data.id });
  });
}

/** Lote: SOMENTE rascunhos de Follow-up (SPEC-019). Cada um passa pela política de envio individualmente. */
export async function bulkApproveFollowups(input: unknown): Promise<ActionResult<{ sent: number; blocked: number; skipped: number }>> {
  return safeAction(async () => {
    const actor = await requireUser();
    const parsed = bulkApproveSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const rows = await prisma.draft.findMany({ where: { id: { in: parsed.data.ids }, status: "pending", agentRun: { agent: { role: "followup" } } }, select: { id: true }, orderBy: { createdAt: "asc" } });
    let sent = 0, blocked = 0;
    for (const r of rows) {
      const out = await dispatchDraft(r.id, { reviewer: actor.id }).catch(() => ({ status: "blocked" as const }));
      if (out.status === "blocked") blocked++;
      else sent++;
    }
    revalidate();
    return success({ sent, blocked, skipped: parsed.data.ids.length - rows.length });
  });
}

/** Usuário assumiu a conversa: o agente para de agir no lead e rascunhos pendentes expiram. */
export async function takeOverLead(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    await requireUser();
    const parsed = idSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    await stopAgentOnManualReply(parsed.data.id);
    revalidatePath("/leads");
    revalidatePath("/pipeline");
    revalidate();
    return success({ id: parsed.data.id });
  });
}

