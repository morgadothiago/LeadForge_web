import { prisma } from "@/lib/prisma";
import { buildMetric, type DashboardMetrics, type PeriodRanges } from "@/lib/queries/dashboard";

/** Metricas do painel SEM auth (o chamador autentica: requireUser na web, requireMobile no app; SPEC-022). */
type Range = { from: Date; to: Date };

export async function getMetrics(ranges: PeriodRanges, campaignId?: string): Promise<DashboardMetrics> {
  const leadWhere = campaignId ? { campaignId } : {};
  const inLead = campaignId ? { lead: { campaignId } } : {};
  const count = (r: Range) =>
    Promise.all([
      prisma.lead.count({ where: { ...leadWhere, createdAt: { gte: r.from, lt: r.to } } }),
      // "Em follow-up" = transições para em_followup registradas em StageHistory no período.
      prisma.stageHistory.count({
        where: {
          toStage: "em_followup",
          changedAt: { gte: r.from, lt: r.to },
          ...(campaignId ? { opportunity: { campaignId } } : {}),
        },
      }),
      // D8 (INFERRED): resposta = Touch inbound.
      prisma.touch.count({
        where: { ...inLead, direction: "inbound", createdAt: { gte: r.from, lt: r.to } },
      }),
      prisma.meeting.count({
        where: { ...inLead, createdAt: { gte: r.from, lt: r.to } },
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

