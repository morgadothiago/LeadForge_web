import { prisma } from "@/lib/prisma";
import { AppError, safeErrorForLog } from "@/lib/errors";
import { findSuppression } from "@/lib/domain/suppression";
import { classifyInboundText } from "@/lib/domain/whatsapp-optout";
import type { Channel, Prisma } from "@prisma/client";
import { applyDisclosure, askedIfBot, checkGuardrails, validateOutputShape } from "./guardrails";
import { inboundHandoff, type HandoffReason } from "./handoff";
import { decideDelivery } from "./autonomy";
import { budgetState, costMicros, monthStart } from "./budget";
import { buildSystemPrompt, buildUserPrompt, packKnowledge, type LeadContext } from "./prompt";
import { getLlmProvider, type LlmProvider } from "./provider";
import { advanceAfterAgentStep } from "./advance";
import { markHandoff } from "./lead-state";
import { dispatchDraft } from "./drafts";
import { startOfLocalDay, startOfNextLocalDay } from "@/lib/whatsapp/send-window";
import { stripCallLink } from "./guardrails";
import { escalationRulesSchema, type AgentConfig } from "./types";

export type RunOutcome =
  | { status: "skipped"; reason: string }
  | { status: "deferred"; reason: "daily_limit" | "budget_exhausted" | "kill_switch" }
  | { status: "handoff"; reason: HandoffReason }
  | { status: "blocked"; violations: string[] }
  | { status: "draft"; draftId: string }
  | { status: "sent"; draftId: string }
  | { status: "tagged" }
  | { status: "no_action" };

export interface RunAgentInput {
  runId: string;
  now?: Date;
  provider?: LlmProvider;
}

const MAX_HISTORY_ROWS = 8;
const DEFAULT_TZ = "America/Sao_Paulo";

/** Gasto do mês (micro-USD) do agente e global. */
export async function monthlySpend(agentId: string | null, now: Date): Promise<number> {
  const r = await prisma.agentRun.aggregate({ _sum: { costMicros: true }, where: { createdAt: { gte: monthStart(now) }, ...(agentId ? { agentId } : {}) } });
  return r._sum.costMicros ?? 0;
}

async function finish(runId: string, data: Prisma.AgentRunUpdateInput): Promise<void> {
  await prisma.agentRun.update({ where: { id: runId }, data: { ...data, processedAt: new Date() } });
}

/**
 * Executa UMA tarefa de agente (AgentRun `running`). O agente PROPÕE; a política de envio (sendEmail/sendWhatsApp) DECIDE.
 * Opt-out/supressão/handoff/limites são checados ANTES de chamar o modelo (que nunca vê telefone/e-mail).
 */
export async function runAgentTask(input: RunAgentInput): Promise<RunOutcome> {
  const now = input.now ?? new Date();
  const run = await prisma.agentRun.findUnique({ where: { id: input.runId }, include: { agent: { include: { knowledge: true } } } });
  if (!run) throw new AppError({ code: "not_found", userMessage: "Tarefa do agente não encontrada." });
  const agent = run.agent as unknown as AgentConfig & { knowledge: { id: string; title: string; content: string; agentId: string | null }[] };
  const skip = async (reason: string, status: "skipped" | "failed" = "skipped"): Promise<RunOutcome> => {
    await finish(run.id, { status, error: reason });
    if (run.stepId) await advanceAfterAgentStep(run.leadId, run.stepId, now);
    return { status: "skipped", reason };
  };
  const callNote = agent.role === "closer" && agent.callLink ? `Link da call: ${agent.callLink}` : null;
  const handoff = async (reason: HandoffReason, violations: string[] = []): Promise<RunOutcome> => {
    await finish(run.id, { status: violations.length ? "blocked" : "handoff", error: reason, guardrailsViolated: violations });
    await markHandoff(run.leadId, reason, now, callNote);
    return violations.length ? { status: "blocked", violations } : { status: "handoff", reason };
  };

  const settings = await prisma.agentSettings.findUnique({ where: { id: "global" } });
  // Kill switch: NAO consome/pula a tarefa nem avanca o passo; fica na fila e retoma quando for desligado.
  if (settings?.killSwitch !== false) {
    await prisma.agentRun.update({ where: { id: run.id }, data: { status: "queued" } });
    return { status: "deferred", reason: "kill_switch" };
  }
  if (!agent.active) return skip("agente_inativo");
  if (agent.monthlyBudgetCents === null) return skip("sem_teto_de_gasto");

  const lead = await prisma.lead.findUnique({
    where: { id: run.leadId },
    include: { campaign: { include: { icp: true } } },
  });
  if (!lead) return skip("lead_removido");
  if (lead.optedOutAt || lead.sequenceStatus === "opted_out") return skip("opt_out");
  if (await findSuppression({ email: lead.email, phone: lead.phone })) return skip("suprimido");
  if (lead.handoffAt) return skip("agente_parou_neste_lead");
  const isInbound = run.trigger.startsWith("inbound");
  if (!isInbound && (lead.repliedAt || lead.sequenceStatus === "paused_replied")) return skip("lead_respondeu");

  // Orçamento: hard stop em 100% (agente e global); a tarefa continua na fila (retomada quando o teto subir/virar o mês).
  const agentState = budgetState(await monthlySpend(agent.id, now), agent.monthlyBudgetCents);
  const globalState = settings?.monthlyBudgetCents != null ? budgetState(await monthlySpend(null, now), settings.monthlyBudgetCents) : "ok";
  if (agentState === "exhausted" || globalState === "exhausted") {
    await prisma.agentRun.update({ where: { id: run.id }, data: { status: "queued" } });
    return { status: "deferred", reason: "budget_exhausted" };
  }
  // Limite diário de mensagens propostas por este agente.
  // Conta mensagens PROPOSTAS (rascunhos criados) no dia local do fuso padrao do sistema (mesmo criterio de dia da SPEC-017); handoff/skip/deferido nao geram mensagem.
  const today = await prisma.draft.count({ where: { agentRun: { agentId: agent.id }, createdAt: { gte: startOfLocalDay(DEFAULT_TZ, now), lt: startOfNextLocalDay(DEFAULT_TZ, now) } } });
  if (today >= agent.dailyMessageLimit) {
    await prisma.agentRun.update({ where: { id: run.id }, data: { status: "queued" } });
    return { status: "deferred", reason: "daily_limit" };
  }

  if (lead.agentTurns >= agent.maxTurnsPerLead) return handoff("max_turns");

  const history = await prisma.touch.findMany({
    where: { leadId: lead.id, content: { not: null } },
    orderBy: { createdAt: "desc" }, take: MAX_HISTORY_ROWS,
    select: { direction: true, channel: true, content: true, status: true },
  });
  const lastInbound = history.find((h) => h.direction === "inbound")?.content ?? null;
  const inboundText = isInbound ? lastInbound : null;

  if (isInbound && inboundText) {
    // Opt-out e supressão NUNCA passam pela IA (SPEC-012 D18 já rodou; defesa em profundidade).
    const kind = classifyInboundText(inboundText);
    if (kind !== "reply") return skip("opt_out_ou_recusa");
    const h = inboundHandoff(inboundText, agent.escalationRules);
    if (h) return handoff(h);
  }

  const globalDocs = await prisma.knowledgeDocument.findMany({ where: { agentId: null }, select: { id: true, title: true, content: true } });
  const knowledge = packKnowledge([...agent.knowledge.map((k) => ({ id: k.id, title: k.title, content: k.content })), ...globalDocs]);
  const step = run.stepId ? await prisma.sequenceStep.findUnique({ where: { id: run.stepId }, select: { channel: true } }) : null;
  const channel: "email" | "whatsapp" = step?.channel === "email" || step?.channel === "whatsapp" ? step.channel : lead.phone ? "whatsapp" : "email";
  if (channel === "whatsapp" && !lead.phone) return skip("sem_telefone");
  if (channel === "email" && !lead.email) return skip("sem_email");

  const ctx: LeadContext = {
    firstName: lead.name.trim().split(/\s+/)[0],
    company: lead.company,
    campaign: { name: lead.campaign.name, niche: lead.campaign.icp.niche, location: lead.campaign.icp.location },
    history: history.reverse().filter((h) => h.direction === "inbound" || h.direction === "outbound").map((h) => ({ direction: h.direction, channel: h.channel, content: h.content ?? "" })),
    inboundText,
    turn: lead.agentTurns + 1,
    goal: isInbound ? "reply" : agent.role === "followup" ? "followup" : "first_touch",
  };

  let result;
  try {
    const provider = input.provider ?? (await getLlmProvider());
    result = await provider.generate({ model: agent.model, system: buildSystemPrompt(agent), user: buildUserPrompt(ctx, knowledge) });
  } catch (e) {
    console.error("[agents] provedor falhou:", safeErrorForLog(e));
    // Validação = saída fora do schema => bloqueio; demais (429/timeout esgotados, sem chave) => handoff, nunca envio às cegas.
    if (e instanceof AppError && e.code === "validation") return handoff("guardrail", ["output_schema"]);
    return handoff("provider_error");
  }
  const { output } = result;
  const cost = costMicros(agent.model, result.tokensIn, result.tokensOut);
  const usage = { model: agent.model, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costMicros: cost, latencyMs: result.latencyMs, result: output as unknown as Prisma.InputJsonValue };

  if (output.action === "handoff") {
    await finish(run.id, { ...usage, status: "handoff", error: "model_handoff" });
    await markHandoff(lead.id, "model_handoff", now, callNote);
    return { status: "handoff", reason: "model_handoff" };
  }
  if (output.action === "skip") {
    await finish(run.id, { ...usage, status: "skipped" });
    if (run.stepId) await advanceAfterAgentStep(lead.id, run.stepId, now);
    return { status: "skipped", reason: "model_skip" };
  }
  if (output.action === "tag") {
    if (agent.allowedTools.includes("tag") && output.tags?.length) {
      const tags = [...new Set([...lead.tags, ...output.tags.map((t) => t.trim().slice(0, 40)).filter(Boolean)])];
      await prisma.lead.update({ where: { id: lead.id }, data: { tags } });
    }
    await finish(run.id, { ...usage, status: "completed" });
    return { status: "tagged" };
  }

  // action=send: confiança + guardrails deterministicos.
  const rules = escalationRulesSchema.parse(agent.escalationRules ?? undefined);
  const violations = validateOutputShape(output, channel);
  if (output.confidence < agent.minConfidence) {
    await finish(run.id, { ...usage, status: "handoff", error: "low_confidence" });
    await markHandoff(lead.id, "low_confidence", now, callNote);
    return { status: "handoff", reason: "low_confidence" };
  }
  const asked = inboundText ? askedIfBot(inboundText) : false;
  const firstTurn = lead.agentTurns === 0;
  const message = applyDisclosure(output.message ?? "", agent.disclosureText, agent.disclosureEnabled, firstTurn, asked);
  // Link da call configurado (https, validado no cadastro) e o unico URL permitido ao Closer sem a ferramenta "link".
  const callLinkStripped = agent.role === "closer" && agent.callLink ? stripCallLink(message, agent.callLink) : message;
  const subject = channel === "email" ? (output.subject ?? "Contato").slice(0, 200) : null;
  if (subject) {
    violations.push(...checkGuardrails({ message: subject, channel: "whatsapp", citedKnowledgeIds: output.citedKnowledgeIds, knowledge, allowLinks: agent.allowedTools.includes("link"), rules, leadAskedIfBot: false, disclosureText: null }));
  }
  violations.push(
    ...checkGuardrails({
      message: callLinkStripped, channel, citedKnowledgeIds: output.citedKnowledgeIds, knowledge, allowLinks: agent.allowedTools.includes("link"),
      rules, leadAskedIfBot: asked, disclosureText: agent.disclosureEnabled ? agent.disclosureText : null,
    }),
  );
  if (violations.length) {
    await finish(run.id, { ...usage, status: "blocked", guardrailsViolated: [...new Set(violations)], error: "guardrail" });
    await markHandoff(lead.id, "guardrail", now);
    return { status: "blocked", violations: [...new Set(violations)] };
  }

  const delivery = decideDelivery(agent, lead.id, agent.id);
  const draft = await prisma.draft.create({
    data: { agentRunId: run.id, leadId: lead.id, channel: channel as Channel, subject, body: message, status: "pending" },
  });
  await finish(run.id, { ...usage, status: "completed" });
  await prisma.lead.update({ where: { id: lead.id }, data: { agentTurns: { increment: 1 } } });
  if (delivery === "review") return { status: "draft", draftId: draft.id };
  // auto/amostra sem revisão: mesmo caminho da aprovação => sempre atrás da política de envio (SPEC-017).
  await dispatchDraft(draft.id, { reviewer: null, now });
  return { status: "sent", draftId: draft.id };
}
