import { prisma } from "@/lib/prisma";
import { HANDOFF_LABEL, type HandoffReason } from "./handoff";

/** Marca "Precisa de você": o agente para de agir nesse lead. Pausa a sequência (paused_manual) se ainda ativa. */
export async function markHandoff(leadId: string, reason: HandoffReason, now = new Date(), note?: string | null): Promise<void> {
  await prisma.lead.updateMany({ where: { id: leadId, handoffAt: null }, data: { needsHuman: reason !== "manual_takeover", handoffAt: now, handoffReason: note ? `${HANDOFF_LABEL[reason]}. ${note}` : HANDOFF_LABEL[reason] } });
  await prisma.lead.updateMany({ where: { id: leadId, sequenceStatus: "active" }, data: { sequenceStatus: "paused_manual", nextTouchAt: null } });
}

/** Usuário respondeu/assumiu manualmente: o agente para (sem alerta "precisa de você"). Rascunhos pendentes do lead expiram. */
export async function stopAgentOnManualReply(leadId: string, now = new Date()): Promise<void> {
  await markHandoff(leadId, "manual_takeover", now);
  await prisma.draft.updateMany({ where: { leadId, status: "pending" }, data: { status: "expired" } });
}
