import { Prisma, type Stage, type SuppressionReason } from "@prisma/client";
import { addSuppression } from "./suppression";
import { classifyInboundText, type InboundClass } from "./whatsapp-optout";
import { moveOpportunityInTx } from "./move-opportunity";

export const OPT_OUT_LOST_REASON = "Opt-out por WhatsApp";
const CONTENT_MAX = 4000;
/** Só estes estágios avançam para `interessado` em uma resposta; os demais NUNCA regridem (perdido não é reaberto). */
const ADVANCE_FROM: readonly Stage[] = ["novo_lead", "contactado", "em_followup"];

export interface InboundInput {
  from: string;
  text: string;
  externalId: string;
  timestamp: Date;
}

export interface LeadCandidate {
  id: string;
  createdAt: Date;
  sequenceStatus: string;
  campaignInstanceId: string | null;
  /** Último envio WhatsApp desta instância para o lead. */
  lastSentByInstance: Date | null;
}

/**
 * Lead é único por campanha, mas o mesmo telefone pode existir em várias. Escolhe: (1) o que tem relação com ESTA instância
 * (campanha vinculada a ela ou já recebeu envio dela), (2) sequência ativa, (3) contato mais recente por esta instância, (4) lead mais novo.
 * Resposta de telefone sem relação com a instância ainda é atribuída (ranking abaixo), para não perder resposta espontânea.
 */
export function pickLead<T extends LeadCandidate>(candidates: T[], instanceId: string): T | null {
  const score = (c: T) => [
    c.campaignInstanceId === instanceId || c.lastSentByInstance ? 1 : 0,
    c.sequenceStatus === "active" ? 1 : 0,
    c.lastSentByInstance?.getTime() ?? 0,
    c.createdAt.getTime(),
  ];
  const sorted = [...candidates].sort((a, b) => {
    const sa = score(a), sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sb[i] - sa[i];
    return a.id < b.id ? -1 : 1;
  });
  return sorted[0] ?? null;
}

export type InboundOutcome =
  | { status: "lead_not_found" }
  | { status: "processed"; leadId: string; kind: InboundClass; stageChanged: boolean };

interface OppRef { id: string; stage: Stage }

/**
 * Efeito do opt-out (automático D18 ou manual `confirmOptOut`): `opted_out` + `optedOutAt`, limpa alerta, encerra touches pendentes e
 * move a Opportunity para `perdido` ("Opt-out por WhatsApp"). Estágio `fechado`/`perdido` não é movido (não sobrescreve venda nem motivo existente).
 */
export async function applyOptOut(tx: Prisma.TransactionClient, leadId: string, opp: OppRef | null, now: Date, reason: SuppressionReason = "opt_out_reply"): Promise<boolean> {
  // SPEC-017/030: supressão por-org (telefone + e-mail do lead), vale para outras campanhas DA MESMA org.
  const contact = await tx.lead.findUnique({ where: { id: leadId }, select: { email: true, phone: true, campaign: { select: { orgId: true } } } });
  if (contact) await addSuppression(tx, contact.campaign.orgId, { email: contact.email, phone: contact.phone, reason, leadId });
  await tx.lead.updateMany({ where: { id: leadId, optedOutAt: null }, data: { optedOutAt: now } });
  await tx.lead.update({ where: { id: leadId }, data: { sequenceStatus: "opted_out", possibleOptOut: false, nextTouchAt: null } });
  await tx.touch.updateMany({ where: { leadId, status: { in: ["pending", "scheduled"] } }, data: { status: "skipped" } });
  if (opp && opp.stage !== "perdido" && opp.stage !== "fechado") {
    const r = await moveOpportunityInTx(tx, { opportunityId: opp.id, toStage: "perdido", toIndex: 0, lostReason: OPT_OUT_LOST_REASON });
    return !!r?.changed;
  }
  return false;
}

/** Transacional (o chamador abre a $transaction Serializable e trata conflito via withSerializableRetry). Sem chamadas externas. */
export async function processInbound(tx: Prisma.TransactionClient, instance: { id: string; orgId: string }, msg: InboundInput, now: Date): Promise<InboundOutcome> {
  // SPEC-030: o mesmo telefone pode existir em orgs diferentes — nunca cruzar (a instância pertence a 1 org só).
  const rows = await tx.lead.findMany({
    where: { phone: msg.from, campaign: { orgId: instance.orgId } },
    select: {
      id: true, createdAt: true, sequenceStatus: true, optedOutAt: true,
      campaign: { select: { whatsappInstanceId: true } },
      opportunities: { select: { id: true, stage: true }, take: 1 },
      touches: {
        where: { direction: "outbound", channel: "whatsapp", whatsappInstanceId: instance.id, sentAt: { not: null } },
        orderBy: { sentAt: "desc" }, take: 1, select: { sentAt: true },
      },
    },
  });
  const lead = pickLead(
    rows.map((r) => ({ ...r, campaignInstanceId: r.campaign.whatsappInstanceId, lastSentByInstance: r.touches[0]?.sentAt ?? null })),
    instance.id,
  );
  if (!lead) return { status: "lead_not_found" };

  const kind = classifyInboundText(msg.text);
  const at = msg.timestamp.getTime() > now.getTime() ? now : msg.timestamp;
  await tx.touch.create({
    data: {
      leadId: lead.id, channel: "whatsapp", direction: "inbound", status: "replied", content: msg.text.slice(0, CONTENT_MAX),
      externalId: msg.externalId, sentAt: at, repliedAt: at, whatsappInstanceId: instance.id,
    },
  });

  const opp: OppRef | null = lead.opportunities[0] ?? null;
  if (lead.sequenceStatus === "opted_out") {
    await tx.lead.update({ where: { id: lead.id }, data: { repliedAt: at } });
    return { status: "processed", leadId: lead.id, kind, stageChanged: false };
  }
  if (kind === "opt_out") {
    await tx.lead.update({ where: { id: lead.id }, data: { repliedAt: at } });
    const stageChanged = await applyOptOut(tx, lead.id, opp, now);
    return { status: "processed", leadId: lead.id, kind, stageChanged };
  }

  const pause = lead.sequenceStatus === "active" || lead.sequenceStatus === "not_started";
  await tx.lead.update({
    where: { id: lead.id },
    data: { repliedAt: at, ...(kind === "possible_opt_out" ? { possibleOptOut: true } : {}), ...(pause ? { sequenceStatus: "paused_replied", nextTouchAt: null } : {}) },
  });
  await tx.touch.updateMany({ where: { leadId: lead.id, status: { in: ["pending", "scheduled"] } }, data: { status: "skipped" } });
  // SPEC-019: resposta comum enfileira tarefa do Closer (só INSERT; o LLM roda depois, fora do webhook). Opt-out/recusa nunca chegam aqui.
  if (kind === "reply") {
    const s = await tx.agentSettings.findUnique({ where: { orgId: instance.orgId } });
    const closer = s?.killSwitch === false ? await tx.agent.findFirst({ where: { orgId: instance.orgId, role: "closer", active: true }, select: { id: true }, orderBy: { createdAt: "asc" } }) : null;
    if (closer) await tx.agentRun.create({ data: { agentId: closer.id, leadId: lead.id, trigger: `inbound:${msg.externalId}`.slice(0, 120), status: "queued" } });
  }
  let stageChanged = false;
  // possible_opt_out é recusa: pausa, mas NÃO avança o estágio.
  if (kind === "reply" && opp && ADVANCE_FROM.includes(opp.stage)) {
    const r = await moveOpportunityInTx(tx, { opportunityId: opp.id, toStage: "interessado", toIndex: 0 });
    stageChanged = !!r?.changed;
  }
  return { status: "processed", leadId: lead.id, kind, stageChanged };
}
