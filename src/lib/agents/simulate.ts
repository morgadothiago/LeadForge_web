import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { budgetState, costMicros } from "./budget";
import { monthlySpend } from "./run-agent";
import { applyDisclosure, askedIfBot, checkGuardrails, validateOutputShape } from "./guardrails";
import { buildSystemPrompt, buildUserPrompt, packKnowledge } from "./prompt";
import { getLlmProvider, type LlmProvider } from "./provider";
import { stripCallLink } from "./guardrails";
import { escalationRulesSchema, type AgentOutput } from "./types";

export interface SimulationResult { output: AgentOutput; message: string; violations: string[]; costMicros: number; tokensIn: number; tokensOut: number }

/** Dry-run: mesmo prompt e guardrails, sem persistir AgentRun/Draft, sem enviar e sem tocar no lead. Mostra custo. */
export async function simulateAgent(input: { agentId: string; leadId?: string; inboundText?: string }, provider?: LlmProvider): Promise<SimulationResult> {
  const agent = await prisma.agent.findUnique({ where: { id: input.agentId }, include: { knowledge: true } });
  if (!agent) throw new AppError({ code: "not_found", userMessage: "Agente não encontrado." });
  // Mesmas travas do fluxo real: kill switch global e orcamento (agente e global) valem tambem para o dry-run (gasta tokens de verdade).
  const settings = await prisma.agentSettings.findUnique({ where: { id: "global" } });
  if (settings?.killSwitch !== false) throw new AppError({ code: "conflict", userMessage: "O kill switch global está ligado. Desligue-o para simular." });
  const now = new Date();
  if (agent.monthlyBudgetCents === null) throw new AppError({ code: "conflict", userMessage: "Defina o teto de gasto mensal do agente para simular." });
  if (budgetState(await monthlySpend(agent.id, now), agent.monthlyBudgetCents) === "exhausted"
    || (settings?.monthlyBudgetCents != null && budgetState(await monthlySpend(null, now), settings.monthlyBudgetCents) === "exhausted")) {
    throw new AppError({ code: "conflict", userMessage: "O orçamento mensal foi atingido. A simulação está bloqueada." });
  }
  const lead = input.leadId ? await prisma.lead.findUnique({ where: { id: input.leadId }, include: { campaign: { include: { icp: true } } } }) : null;
  const globals = await prisma.knowledgeDocument.findMany({ where: { agentId: null } });
  const knowledge = packKnowledge([...agent.knowledge, ...globals].map((k) => ({ id: k.id, title: k.title, content: k.content })));
  const p = provider ?? (await getLlmProvider());
  const res = await p.generate({
    model: agent.model,
    system: buildSystemPrompt(agent),
    user: buildUserPrompt({
      firstName: lead ? lead.name.trim().split(/\s+/)[0] : "Maria",
      company: lead?.company ?? "Empresa Exemplo",
      campaign: { name: lead?.campaign.name ?? "Campanha de exemplo", niche: lead?.campaign.icp.niche ?? null, location: lead?.campaign.icp.location ?? null },
      history: [], inboundText: input.inboundText ?? null, turn: 1,
      goal: input.inboundText ? "reply" : agent.role === "followup" ? "followup" : "first_touch",
    }, knowledge),
  });
  const o = res.output;
  // Canal real: o do passo de sequencia que usa este agente (senao whatsapp se houver telefone/sem lead, senao email).
  const step = await prisma.sequenceStep.findFirst({ where: { agentId: agent.id }, orderBy: { order: "asc" }, select: { channel: true } });
  const channel: "email" | "whatsapp" = step?.channel === "email" || step?.channel === "whatsapp" ? step.channel : lead && !lead.phone && lead.email ? "email" : "whatsapp";
  const cost = costMicros(agent.model, res.tokensIn, res.tokensOut);
  // Custo entra no orcamento: AgentRun exige lead (FK); ancora no lead informado ou em qualquer lead existente. Sem lead algum, nao registra (limitacao).
  const anchor = lead ?? (await prisma.lead.findFirst({ select: { id: true, campaign: { select: { id: true } } } }));
  if (anchor) {
    await prisma.agentRun.create({ data: { agentId: agent.id, leadId: anchor.id, trigger: `simulation:${now.getTime()}:${Math.random().toString(36).slice(2, 8)}`, status: "completed", model: agent.model, tokensIn: res.tokensIn, tokensOut: res.tokensOut, costMicros: cost, latencyMs: res.latencyMs, processedAt: now } });
  }
  const asked = input.inboundText ? askedIfBot(input.inboundText) : false;
  const message = applyDisclosure(o.message ?? "", agent.disclosureText, agent.disclosureEnabled, true, asked);
  const guardedMessage = agent.role === "closer" && agent.callLink ? stripCallLink(message, agent.callLink) : message;
  const violations = o.action === "send"
    ? [...validateOutputShape(o, channel), ...checkGuardrails({ message: guardedMessage, channel, citedKnowledgeIds: o.citedKnowledgeIds, knowledge, allowLinks: agent.allowedTools.includes("link"), rules: escalationRulesSchema.parse(agent.escalationRules ?? undefined), leadAskedIfBot: asked, disclosureText: agent.disclosureEnabled ? agent.disclosureText : null })]
    : [];
  return { output: o, message, violations, costMicros: cost, tokensIn: res.tokensIn, tokensOut: res.tokensOut };
}
