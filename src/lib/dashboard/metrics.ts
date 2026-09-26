import { scopedPrisma } from "@/lib/tenant/scoped-prisma";
import { buildMetric, type DashboardMetrics, type PeriodRanges } from "@/lib/queries/dashboard";

/**
 * Metricas do painel SEM auth (o chamador autentica: requireUser na web, requireMobile no app; SPEC-022).
 * SPEC-030: sempre escopado por org via `scopedPrisma(orgId)` — `orgId` obrigatorio.
 */
type Range = { from: Date; to: Date };

export async function getMetrics(orgId: string, ranges: PeriodRanges, campaignId?: string): Promise<DashboardMetrics> {
  const db = scopedPrisma(orgId);
  const leadWhere = campaignId ? { campaignId } : {};
  const inLead = campaignId ? { lead: { campaignId } } : {};
  const count = (r: Range) =>
    Promise.all([
      db.lead.count({ where: { ...leadWhere, createdAt: { gte: r.from, lt: r.to } } }),
      // "Em follow-up" = transições para em_followup registradas em StageHistory no período.
      db.stageHistory.count({
        where: {
          toStage: "em_followup",
          changedAt: { gte: r.from, lt: r.to },
          ...(campaignId ? { opportunity: { campaignId } } : {}),
        },
      }),
      // D8 (INFERRED): resposta = Touch inbound.
      db.touch.count({
        where: { ...inLead, direction: "inbound", createdAt: { gte: r.from, lt: r.to } },
      }),
      db.meeting.count({
        where: { ...inLead, status: { not: "cancelled" }, createdAt: { gte: r.from, lt: r.to } }, // SPEC-028 D-R9
      }),
    ]);
  const [cur, prev] = await Promise.all([count(ranges.current), count(ranges.previous)]);
  return {
    newLeads: buildMetric(cur[0], prev[0]),
    followUp: buildMetric(cur[1], prev[1]),
    replies: buildMetric(cur[2], prev[2]),
    meetings: buildMetric(cur[3], prev[3]),
  };
}

