import { requireProviderOrg } from "@/lib/auth/require-admin";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";
import { MEETING_MAX_RANGE_DAYS, leadSearchSchema, meetingRangeSchema } from "@/lib/schemas/meeting";

/** SPEC-028 queries (requireUser primeiro). Intervalo obrigatorio com teto de 62 dias; 1 query com select (sem N+1). */
export interface MeetingListItem {
  id: string; opportunityId: string; leadId: string; leadName: string; company: string | null; campaignId: string; campaignName: string;
  startsAt: Date; endsAt: Date; durationMin: number; timezone: string; status: string; link: string | null; notes: string | null; source: string;
}

export type MeetingRangeResult = { ok: true; items: MeetingListItem[] } | { ok: false; error: string };

export async function listMeetings(input: { from: unknown; to: unknown }): Promise<MeetingRangeResult> {
  const { orgId } = await requireProviderOrg();
  const db = scopedPrisma(orgId);
  const p = meetingRangeSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Intervalo inválido." };
  const { from, to } = p.data;
  if (to.getTime() <= from.getTime()) return { ok: false, error: "O fim do intervalo deve ser posterior ao início." };
  if (to.getTime() - from.getTime() > MEETING_MAX_RANGE_DAYS * 86_400_000) return { ok: false, error: `Intervalo máximo: ${MEETING_MAX_RANGE_DAYS} dias.` };
  const rows = await db.meeting.findMany({
    where: { startsAt: { gte: from, lt: to } },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    take: 1000,
    select: {
      id: true, opportunityId: true, leadId: true, campaignId: true, startsAt: true, endsAt: true, duration: true, timezone: true, status: true, link: true, notes: true, source: true,
      lead: { select: { name: true, company: true } }, campaign: { select: { name: true } },
    },
  });
  type Row = {
    id: string; opportunityId: string; leadId: string; campaignId: string; startsAt: Date; endsAt: Date; duration: number;
    timezone: string; status: string; link: string | null; notes: string | null; source: string;
    lead: { name: string; company: string | null }; campaign: { name: string };
  };
  return {
    ok: true,
    items: (rows as Row[]).map(({ lead, campaign, duration, ...m }) => ({ ...m, leadName: lead.name, company: lead.company, campaignName: campaign.name, durationMin: duration })),
  };
}

export interface LeadOpportunityOption { opportunityId: string; leadId: string; leadName: string; company: string | null; campaignName: string; stage: string }

/** Busca de leads (por nome/empresa) para o dialog de nova reuniao: devolve a oportunidade a usar. */
export async function searchLeadsForMeeting(q: unknown): Promise<LeadOpportunityOption[]> {
  const { orgId } = await requireProviderOrg();
  const db = scopedPrisma(orgId);
  const p = leadSearchSchema.safeParse({ q });
  if (!p.success) return [];
  const rows = await db.opportunity.findMany({
    where: { lead: { OR: [{ name: { contains: p.data.q, mode: "insensitive" } }, { company: { contains: p.data.q, mode: "insensitive" } }] } },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: { id: true, stage: true, leadId: true, lead: { select: { name: true, company: true } }, campaign: { select: { name: true } } },
  });
  type Row = { id: string; stage: string; leadId: string; lead: { name: string; company: string | null }; campaign: { name: string } };
  return (rows as Row[]).map((o) => ({ opportunityId: o.id, leadId: o.leadId, leadName: o.lead.name, company: o.lead.company, campaignName: o.campaign.name, stage: o.stage }));
}

/** SPEC-029: dia da reuniao (para abrir `/calendario?meeting=id` sem `date`). So o instante; sem PII. */
export async function getMeetingStart(id: unknown): Promise<Date | null> {
  const { orgId } = await requireProviderOrg();
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const m = await scopedPrisma(orgId).meeting.findUnique({ where: { id }, select: { startsAt: true } });
  return m?.startsAt ?? null;
}
