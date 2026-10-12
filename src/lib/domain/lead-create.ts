import type { Prisma } from "@prisma/client";
import { reserveLeadOrThrow } from "@/lib/billing/usage";
import { recordStageChange } from "./stage-history";

/** Núcleo de criação de lead (compartilhado pela ação `createLead` e pela ingestão SPEC-014): Lead + Opportunity `novo_lead` (fim da coluna) + StageHistory. Deve rodar DENTRO de uma transação. */
export interface LeadCoreInput {
  campaignId: string;
  name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  linkedin?: string | null;
  source: string;
  tags?: string[];
  rawData?: Prisma.InputJsonValue;
}

export async function createLeadCore(tx: Prisma.TransactionClient, d: LeadCoreInput): Promise<{ id: string; opportunityId: string }> {
  const lead = await tx.lead.create({
    data: {
      campaignId: d.campaignId,
      name: d.name,
      company: d.company ?? null,
      email: d.email ?? null,
      phone: d.phone ?? null,
      website: d.website ?? null,
      linkedin: d.linkedin ?? null,
      source: d.source,
      ...(d.tags ? { tags: d.tags } : {}),
      ...(d.rawData !== undefined ? { rawData: d.rawData } : {}),
    },
    select: { id: true },
  });
  // SPEC-065 (D-065-17/18): PONTO UNICO do limite `maxLeadsPerMonth` (createLead, ingestao webhook, busca de leads, lead-source). Reserva atomica
  // DENTRO da transacao do insert: rollback (ex.: duplicado P2002 logo acima/abaixo) devolve a cota; apagar o lead depois NAO devolve. Lanca `PlanLimitError`.
  const camp = await tx.campaign.findUniqueOrThrow({ where: { id: d.campaignId }, select: { orgId: true } });
  await reserveLeadOrThrow(tx, camp.orgId, new Date());
  const last = await tx.opportunity.aggregate({ where: { campaignId: d.campaignId, stage: "novo_lead" }, _max: { position: true } });
  const opp = await tx.opportunity.create({
    data: { leadId: lead.id, campaignId: d.campaignId, stage: "novo_lead", position: (last._max.position ?? -1) + 1 },
    select: { id: true },
  });
  await recordStageChange(tx, opp.id, null, "novo_lead");
  return { id: lead.id, opportunityId: opp.id };
}
