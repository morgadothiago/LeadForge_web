import { z } from "zod";
import { addDays, startOfDay, subDays } from "date-fns";
import type { Prisma, Stage, Channel, TouchDirection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";

/* ---------- Input (Zod) ---------- */

export const dashboardParamsSchema = z.object({
  period: z.enum(["7d", "30d"]).catch("7d").default("7d"),
  campaignId: z.uuid().optional().catch(undefined),
});
export type DashboardParams = z.infer<typeof dashboardParamsSchema>;

/** Aceita searchParams do Next (string | string[] | undefined). Nunca lança. */
export function parseDashboardParams(
  raw: Record<string, string | string[] | undefined>,
): DashboardParams {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return dashboardParamsSchema.parse({
    period: first(raw.period),
    campaignId: first(raw.campaignId),
  });
}

/* ---------- Tipos de saída ---------- */

export type TrendDirection = "up" | "down" | "flat";
export interface Trend {
  /** Variação % vs período anterior; null quando anterior = 0 (UI exibe "—"). */
  percent: number | null;
  direction: TrendDirection;
}
export interface Metric {
  value: number;
  previous: number;
  trend: Trend;
}
export interface DashboardMetrics {
  newLeads: Metric;
  followUp: Metric;
  replies: Metric;
  meetings: Metric;
}
export interface WeeklyPoint {
  /** yyyy-MM-dd (fuso do servidor) */
  date: string;
  newLeads: number;
  replies: number;
  sent: number;
}
export type ActivityKind = "touch_outbound" | "touch_inbound" | "stage_change";
export interface DashboardActivity {
  id: string;
  kind: ActivityKind;
  at: Date;
  leadId: string;
  leadName: string;
  channel: Channel | null;
  stage: Stage | null;
}
export interface DashboardData {
  metrics: DashboardMetrics;
  weekly: WeeklyPoint[];
  activities: DashboardActivity[];
  isEmpty: boolean;
}

/* ---------- Funções puras ---------- */

export function computeTrend(current: number, previous: number): Trend {
  if (previous === 0) {
    return { percent: null, direction: current > 0 ? "up" : "flat" };
  }
  const percent = Math.round(((current - previous) / previous) * 1000) / 10;
  return { percent, direction: percent > 0 ? "up" : percent < 0 ? "down" : "flat" };
}

export function buildMetric(value: number, previous: number): Metric {
  return { value, previous, trend: computeTrend(value, previous) };
}

export interface PeriodRanges {
  current: { from: Date; to: Date };
  previous: { from: Date; to: Date };
}
/** Intervalos [from, to) — atual termina em now; anterior tem mesma duração. */
export function getPeriodRanges(now: Date, period: "7d" | "30d"): PeriodRanges {
  const days = period === "30d" ? 30 : 7;
  const from = startOfDay(subDays(now, days - 1));
  const to = addDays(startOfDay(now), 1);
  return {
    current: { from, to },
    previous: { from: subDays(from, days), to: from },
  };
}

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function buildWeeklySeries(
  now: Date,
  rows: { createdAt: Date; kind: "lead" | "inbound" | "outbound" }[],
): WeeklyPoint[] {
  const points = new Map<string, WeeklyPoint>();
  for (let i = 6; i >= 0; i--) {
    const date = dayKey(subDays(now, i));
    points.set(date, { date, newLeads: 0, replies: 0, sent: 0 });
  }
  for (const r of rows) {
    const p = points.get(dayKey(r.createdAt));
    if (!p) continue;
    if (r.kind === "lead") p.newLeads++;
    else if (r.kind === "inbound") p.replies++;
    else p.sent++;
  }
  return [...points.values()];
}

export function mergeActivities(
  lists: DashboardActivity[][],
  limit = 10,
): DashboardActivity[] {
  return lists
    .flat()
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit);
}

/* ---------- Queries ---------- */

type Range = { from: Date; to: Date };

async function getMetrics(ranges: PeriodRanges, campaignId?: string): Promise<DashboardMetrics> {
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

async function getWeekly(now: Date, campaignId?: string): Promise<WeeklyPoint[]> {
  const from = startOfDay(subDays(now, 6));
  const to = addDays(startOfDay(now), 1);
  const createdAt = { gte: from, lt: to };
  const [leads, touches] = await Promise.all([
    prisma.lead.findMany({
      where: { ...(campaignId ? { campaignId } : {}), createdAt },
      select: { createdAt: true },
    }),
    prisma.touch.findMany({
      where: { ...(campaignId ? { lead: { campaignId } } : {}), createdAt },
      select: { createdAt: true, direction: true },
    }),
  ]);
  return buildWeeklySeries(now, [
    ...leads.map((l) => ({ createdAt: l.createdAt, kind: "lead" as const })),
    ...touches.map((t) => ({
      createdAt: t.createdAt,
      kind: (t.direction satisfies TouchDirection) as "inbound" | "outbound",
    })),
  ]);
}

async function getActivities(campaignId?: string): Promise<DashboardActivity[]> {
  const leadFilter: Prisma.LeadWhereInput | undefined = campaignId ? { campaignId } : undefined;
  const [touches, opps] = await Promise.all([
    prisma.touch.findMany({
      where: leadFilter ? { lead: leadFilter } : {},
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { lead: { select: { id: true, name: true } } },
    }),
    // Mudança de stage = StageHistory com origem (entrada inicial, fromStage null, não conta).
    prisma.stageHistory.findMany({
      where: {
        fromStage: { not: null },
        ...(campaignId ? { opportunity: { campaignId } } : {}),
      },
      orderBy: { changedAt: "desc" },
      take: 10,
      include: { opportunity: { include: { lead: { select: { id: true, name: true } } } } },
    }),
  ]);
  return mergeActivities([
    touches.map((t) => ({
      id: `touch:${t.id}`,
      kind: t.direction === "inbound" ? ("touch_inbound" as const) : ("touch_outbound" as const),
      at: t.createdAt,
      leadId: t.lead.id,
      leadName: t.lead.name,
      channel: t.channel,
      stage: null,
    })),
    opps.map((h) => ({
      id: `stage:${h.id}`,
      kind: "stage_change" as const,
      at: h.changedAt,
      leadId: h.opportunity.lead.id,
      leadName: h.opportunity.lead.name,
      channel: null,
      stage: h.toStage,
    })),
  ]);
}

export async function getDashboardData(
  params: DashboardParams,
  now: Date = new Date(),
): Promise<DashboardData> {
  await requireUser();
  const ranges = getPeriodRanges(now, params.period);
  const [metrics, weekly, activities] = await Promise.all([
    getMetrics(ranges, params.campaignId),
    getWeekly(now, params.campaignId),
    getActivities(params.campaignId),
  ]);
  const isEmpty =
    activities.length === 0 &&
    Object.values(metrics).every((m) => m.value === 0 && m.previous === 0);
  return { metrics, weekly, activities, isEmpty };
}
