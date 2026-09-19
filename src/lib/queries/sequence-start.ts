import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { classifyStartable, REASON_LABEL, type IneligibleReason } from "@/lib/domain/sequence-start";
import { campaignIdSchema } from "@/lib/schemas/sequence-start";

export interface StartableLeadsCount {
  campaignId: string;
  campaignActive: boolean;
  hasSequence: boolean;
  autoStart: boolean;
  /** Leads que startCampaignSequences iniciaria agora. */
  eligible: number;
  ineligible: number;
  /** Inelegíveis por motivo (rótulo PT-BR pronto para exibição). */
  ineligibleByReason: { reason: IneligibleReason; label: string; count: number }[];
}

/** Elegíveis x inelegíveis (por motivo) — mostrar ANTES de confirmar startCampaignSequences. Candidatos: not_started e paused_manual. */
export async function countStartableLeads(campaignId: string): Promise<StartableLeadsCount | null> {
  await requireUser();
  const id = campaignIdSchema.parse(campaignId);
  const camp = await prisma.campaign.findUnique({ where: { id }, select: { status: true, sequenceId: true, autoStart: true } });
  if (!camp) return null;
  const s = await classifyStartable(id);
  if (!s) return null;
  return {
    campaignId: id,
    campaignActive: camp.status === "active",
    hasSequence: !!camp.sequenceId,
    autoStart: camp.autoStart,
    eligible: s.eligibleIds.length,
    ineligible: s.ineligibleTotal,
    ineligibleByReason: (Object.entries(s.ineligible) as [IneligibleReason, number][]).map(([reason, count]) => ({ reason, label: REASON_LABEL[reason], count })),
  };
}
