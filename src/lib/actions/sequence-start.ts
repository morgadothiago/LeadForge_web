"use server";

import { withSerializableRetry } from "@/lib/db/tx-conflict";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { STOP_NOTE, activateLeads, classifyStartable, ineligibleReason, loadCampaignCtx, REASON_LABEL, START_LEAD_SELECT, writeSequenceAudit, type IneligibleReason } from "@/lib/domain/sequence-start";
import { findSuppression } from "@/lib/domain/suppression";
import { startCampaignSequencesSchema, startSequenceSchema, stopSequenceSchema } from "@/lib/schemas/sequence-start";
import { failure, formError, safeAction, success, zodErrors, type ActionResult } from "./result";

const revalidate = (campaignId: string, leadId?: string): void => {
  revalidatePath("/campanhas");
  revalidatePath(`/campanhas/${campaignId}`);
  revalidatePath("/leads");
  if (leadId) revalidatePath(`/leads/${leadId}`);
};

/**
 * Inicia a sequência de UM lead (início explícito, SPEC-013). Valida campanha ativa, sequência definida, contato compatível com o 1º canal,
 * não suprimido, não seed; status not_started ou paused_manual. Define active + nextTouchAt=now (o envio real é do próximo tick).
 * Idempotente: lead já `active` -> ok com started=false.
 */
export async function startSequence(input: unknown): Promise<ActionResult<{ leadId: string; started: boolean }>> {
  return safeAction(async () => {
    const user = await requireUser();
    const parsed = startSequenceSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { leadId } = parsed.data;
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { ...START_LEAD_SELECT, campaignId: true } });
    if (!lead) return formError("Lead não encontrado.");
    if (lead.sequenceStatus === "active") return success({ leadId, started: false });
    const ctx = await loadCampaignCtx(lead.campaignId);
    if (!ctx) return formError("Campanha não encontrada.");
    let reason: IneligibleReason | null = ineligibleReason(lead, ctx, false);
    if (!reason && (await findSuppression({ email: lead.email, phone: lead.phone }))) reason = "suppressed";
    if (reason) return failure({ leadId: [REASON_LABEL[reason]] });
    const now = new Date();
    const started = await activateLeads([leadId], now);
    if (started) await writeSequenceAudit({ action: "start_sequence", campaignId: lead.campaignId, leadId, count: 1, userId: user.id });
    revalidate(lead.campaignId, leadId);
    return success({ leadId, started: started > 0 });
  });
}

/**
 * Inicia TODOS os leads elegíveis da campanha (`confirm: true` obrigatório). Retorna a contagem iniciada e as razões de inelegíveis.
 * Não envia nada por si: o próximo tick respeita janelas/limites dos canais.
 */
export async function startCampaignSequences(
  input: unknown,
): Promise<ActionResult<{ campaignId: string; started: number; ineligible: Partial<Record<IneligibleReason, number>>; ineligibleTotal: number }>> {
  return safeAction(async () => {
    const user = await requireUser();
    const parsed = startCampaignSequencesSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { campaignId } = parsed.data;
    const summary = await classifyStartable(campaignId);
    if (!summary) return formError("Campanha não encontrada.");
    const ctx = await loadCampaignCtx(campaignId);
    if (ctx?.status !== "active") return formError(REASON_LABEL.campaign_inactive);
    if (!ctx.sequenceId || !ctx.firstChannel) return formError(REASON_LABEL.no_sequence);
    const started = await activateLeads(summary.eligibleIds, new Date());
    if (started) await writeSequenceAudit({ action: "start_campaign", campaignId, count: started, userId: user.id });
    revalidate(campaignId);
    return success({ campaignId, started, ineligible: summary.ineligible, ineligibleTotal: summary.ineligibleTotal });
  });
}

/**
 * Para a sequência do lead: `paused_manual` e cancela Touches scheduled/pending (skipped). Idempotente (já parado -> stopped=false).
 * Só faz sentido para `active`; outros status devolvem erro PT-BR. Touch `sending` não é tocado. Reiniciar = startSequence.
 */
export async function stopSequence(input: unknown): Promise<ActionResult<{ leadId: string; stopped: boolean; cancelledTouches: number }>> {
  return safeAction(async () => {
    const user = await requireUser();
    const parsed = stopSequenceSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { leadId } = parsed.data;
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { campaignId: true, sequenceStatus: true } });
    if (!lead) return formError("Lead não encontrado.");
    if (lead.sequenceStatus === "paused_manual") return success({ leadId, stopped: false, cancelledTouches: 0 });
    if (lead.sequenceStatus !== "active") return failure({ leadId: ["A sequência deste lead não está ativa."] });
    const cancelled = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
      const r = await tx.lead.updateMany({ where: { id: leadId, sequenceStatus: "active" }, data: { sequenceStatus: "paused_manual", nextTouchAt: null } });
      if (!r.count) return -1;
      const t = await tx.touch.updateMany({
        where: { leadId, direction: "outbound", status: { in: ["pending", "scheduled"] } },
        data: { status: "skipped", error: STOP_NOTE },
      });
      await writeSequenceAudit({ action: "stop_sequence", campaignId: lead.campaignId, leadId, count: t.count, userId: user.id }, tx);
      return t.count;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    revalidate(lead.campaignId, leadId);
    return success({ leadId, stopped: cancelled >= 0, cancelledTouches: Math.max(0, cancelled) });
  });
}
