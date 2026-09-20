import { Prisma, type CampaignStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildMetric, getPeriodRanges } from "@/lib/queries/dashboard";
import { STAGE_LABELS } from "@/lib/queries/pipeline";
import { STAGES } from "@/lib/schemas/pipeline";
import { buildInstanceHealthViews } from "@/lib/whatsapp/health-view";
import { effectiveDailyLimit } from "@/lib/whatsapp/warmup";
import { budgetState, monthStart } from "@/lib/agents/budget";
import { MICROS_PER_CENT } from "@/lib/agents/types";
import { startOfDaySP } from "@/lib/channels/email";
import { ROUTE_MAX_DURATION_S, SCHEDULER_EXPECTED_INTERVAL_MS } from "@/lib/scheduler/config";
import { errorCategory, maskNumber, redactText } from "./sanitize";

/** SPEC-022: servicos de leitura agregada para o app. SEM requireUser (o guard e requireMobile na rota). Somente agregados, sem PII. */

const DAY = 24 * 3600_000;
/** null quando o denominador e 0 (nunca NaN/0). */
export const rate = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 1000) / 1000 : null);

/** contatados (leads distintos com envio outbound na janela) e respondidos (desses, com inbound na janela); subselect escalar. */
const contactSql = (from: Date, to: Date, responded: boolean) =>
  responded
    ? Prisma.sql`(SELECT COUNT(DISTINCT o."leadId") FROM "Touch" o WHERE o.direction = 'outbound' AND o."sentAt" >= ${from} AND o."sentAt" < ${to} AND EXISTS (SELECT 1 FROM "Touch" i WHERE i."leadId" = o."leadId" AND i.direction = 'inbound' AND i."createdAt" >= ${from} AND i."createdAt" < ${to}))`
    : Prisma.sql`(SELECT COUNT(DISTINCT o."leadId") FROM "Touch" o WHERE o.direction = 'outbound' AND o."sentAt" >= ${from} AND o."sentAt" < ${to})`;
const rangeCount = (table: string, col: string, from: Date, to: Date, extra: Prisma.Sql = Prisma.empty) =>
  Prisma.sql`(SELECT COUNT(*) FROM ${Prisma.raw(`"${table}"`)} x WHERE x.${Prisma.raw(`"${col}"`)} >= ${from} AND x.${Prisma.raw(`"${col}"`)} < ${to} ${extra})`;

/**
 * AC7: /summary faz 3 queries (1 SELECT com todos os contadores como subselects escalares + 1 findMany de instancias para o limite efetivo).
 * Mesmas regras de getMetrics (lead novo, follow-up via StageHistory, resposta = Touch inbound, reuniao) e dos demais contadores.
 */
export async function getMobileSummary(period: "7d" | "30d", now: Date) {
  const ranges = getPeriodRanges(now, period);
  const { current: c, previous: p } = ranges;
  const today = startOfDaySP(now);
  const tomorrow = new Date(today.getTime() + DAY);
  const since24h = new Date(now.getTime() - DAY);
  const [rows, waInst] = await Promise.all([
    prisma.$queryRaw<Record<string, bigint | null>[]>`
      SELECT
        ${rangeCount("Lead", "createdAt", c.from, c.to)} AS "newC", ${rangeCount("Lead", "createdAt", p.from, p.to)} AS "newP",
        ${rangeCount("Touch", "createdAt", c.from, c.to, Prisma.sql`AND x.direction = 'inbound'`)} AS "repC", ${rangeCount("Touch", "createdAt", p.from, p.to, Prisma.sql`AND x.direction = 'inbound'`)} AS "repP",
        ${rangeCount("Meeting", "createdAt", c.from, c.to)} AS "meetC", ${rangeCount("Meeting", "createdAt", p.from, p.to)} AS "meetP",
        ${rangeCount("Suppression", "createdAt", c.from, c.to)} AS "optC", ${rangeCount("Suppression", "createdAt", p.from, p.to)} AS "optP",
        ${contactSql(c.from, c.to, false)} AS "conC", ${contactSql(p.from, p.to, false)} AS "conP", ${contactSql(c.from, c.to, true)} AS "resC",
        (SELECT COUNT(*) FROM "Touch" x WHERE x.direction = 'outbound' AND x.channel = 'whatsapp' AND x."sentAt" >= ${today} AND x."sentAt" < ${tomorrow}) AS "waSent",
        (SELECT COUNT(*) FROM "Touch" x WHERE x.direction = 'outbound' AND x.channel = 'email' AND x."sentAt" >= ${today} AND x."sentAt" < ${tomorrow}) AS "emSent",
        (SELECT COALESCE(SUM("dailyLimit"), 0) FROM "EmailAccount" WHERE "isActive" = true) AS "emLimit",
        (SELECT COUNT(*) FROM "Touch" x WHERE x.direction = 'outbound' AND x.status = 'failed' AND x."updatedAt" >= ${since24h}) AS "fail",
        (SELECT COUNT(*) FROM "InstanceAlert" WHERE "readAt" IS NULL) AS "unread",
        (SELECT COUNT(*) FROM "Lead" WHERE "needsHuman" = true) AS "handoffs",
        (SELECT COUNT(*) FROM "Draft" WHERE status = 'pending') AS "drafts"`,
    prisma.whatsAppInstance.findMany({ select: { id: true, dailyLimit: true, warmupStartedAt: true, health: true } }),
  ]);
  const r = rows[0];
  const n = (k: string) => Number(r?.[k] ?? 0);
  const waLimit = waInst.reduce((a, i) => a + effectiveDailyLimit(i.dailyLimit, i.warmupStartedAt, now, i.health), 0);
  const contacted = n("conC");
  const responded = n("resC");
  return {
    period,
    newLeads: buildMetric(n("newC"), n("newP")),
    contacted: buildMetric(contacted, n("conP")),
    replied: buildMetric(n("repC"), n("repP")),
    meetings: buildMetric(n("meetC"), n("meetP")),
    optOut: buildMetric(n("optC"), n("optP")),
    responseRate: { responded, contacted, rate: rate(responded, contacted) },
    sentToday: {
      whatsapp: { sent: n("waSent"), limit: waLimit },
      email: { sent: n("emSent"), limit: n("emLimit") },
    },
    failures24h: n("fail"),
    attention: { unreadAlerts: n("unread"), handoffs: n("handoffs"), pendingDrafts: n("drafts") },
  };
}

export async function getMobilePipeline() {
  const g = await prisma.opportunity.groupBy({ by: ["stage"], _count: { _all: true }, _sum: { value: true } });
  return STAGES.map((stage) => {
    const r = g.find((x) => x.stage === stage);
    return { stage, label: STAGE_LABELS[stage], count: r?._count._all ?? 0, totalValue: r?._sum.value ?? 0 };
  });
}

interface CampStats { sent: number; replies: number; activeLeads: number; nextSendAt: Date | null }
async function campaignStats(ids: string[]): Promise<Map<string, CampStats>> {
  const out = new Map<string, CampStats>(ids.map((id) => [id, { sent: 0, replies: 0, activeLeads: 0, nextSendAt: null }]));
  if (!ids.length) return out;
  const [t, l] = await Promise.all([
    prisma.$queryRaw<{ cid: string; sent: bigint; replies: bigint }[]>`
      SELECT l."campaignId" AS cid,
             COUNT(*) FILTER (WHERE t.direction = 'outbound' AND t."sentAt" IS NOT NULL) AS sent,
             COUNT(*) FILTER (WHERE t.direction = 'inbound') AS replies
      FROM "Touch" t JOIN "Lead" l ON l.id = t."leadId"
      WHERE l."campaignId" = ANY(${ids}::text[]) GROUP BY l."campaignId"`,
    prisma.lead.groupBy({ by: ["campaignId"], where: { campaignId: { in: ids }, sequenceStatus: "active" }, _count: { _all: true }, _min: { nextTouchAt: true } }),
  ]);
  for (const r of t) Object.assign(out.get(r.cid)!, { sent: Number(r.sent), replies: Number(r.replies) });
  for (const r of l) Object.assign(out.get(r.campaignId)!, { activeLeads: r._count._all, nextSendAt: r._min.nextTouchAt });
  return out;
}
const campView = (c: { id: string; name: string; status: CampaignStatus }, s: CampStats) => ({
  id: c.id, name: c.name, status: c.status, sent: s.sent, replies: s.replies, replyRate: rate(s.replies, s.sent), activeLeads: s.activeLeads, nextSendAt: s.nextSendAt,
});

export async function listMobileCampaigns(status: CampaignStatus, page: { limit: number; cursor?: string }) {
  const rows = await prisma.campaign.findMany({
    where: { status },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: page.limit + 1,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    select: { id: true, name: true, status: true },
  });
  const items = rows.slice(0, page.limit);
  const stats = await campaignStats(items.map((c) => c.id));
  return { items: items.map((c) => campView(c, stats.get(c.id)!)), hasMore: rows.length > page.limit };
}

export async function getMobileCampaign(id: string, now: Date) {
  const c = await prisma.campaign.findUnique({ where: { id }, select: { id: true, name: true, status: true } });
  if (!c) return null;
  const start0 = new Date(startOfDaySP(now).getTime() - 6 * DAY);
  const [stats, touches] = await Promise.all([
    campaignStats([id]),
    prisma.touch.findMany({
      where: { lead: { campaignId: id }, OR: [{ direction: "outbound", sentAt: { gte: start0 } }, { direction: "inbound", createdAt: { gte: start0 } }] },
      select: { direction: true, sentAt: true, createdAt: true },
    }),
  ]);
  const series = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start0.getTime() + i * DAY);
    return { date: new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10), sent: 0, replies: 0 };
  });
  for (const t of touches) {
    const at = t.direction === "outbound" ? t.sentAt! : t.createdAt;
    const idx = Math.floor((at.getTime() - start0.getTime()) / DAY);
    if (idx < 0 || idx > 6) continue;
    if (t.direction === "outbound") series[idx].sent++;
    else series[idx].replies++;
  }
  return { ...campView(c, stats.get(id)!), daily: series };
}

export async function getMobileInstances(now: Date) {
  const insts = await prisma.whatsAppInstance.findMany({ orderBy: { createdAt: "asc" }, take: 50 });
  const views = await buildInstanceHealthViews(insts, now); // lote: numero constante de queries (AC7)
  return insts.map((i, idx) => {
    const h = views[idx];
    return {
      id: i.id, instanceName: i.instanceName, numberMasked: maskNumber(i.number), status: i.status, health: h.state,
      pausedUntil: h.pausedUntil, pausedReason: redactText(h.pausedReason), warmupDay: h.warmupDay,
      sentToday: h.sentToday, effectiveLimitToday: h.effectiveLimitToday, warnings: h.warnings,
      alerts: h.alerts.map((a) => ({ id: a.id, kind: a.kind, message: redactText(a.message) ?? "", createdAt: a.createdAt, readAt: a.readAt })),
    };
  });
}

export async function getMobileScheduler(now: Date) {
  const [last, lastOk, running, errors] = await Promise.all([
    prisma.schedulerRun.findFirst({ where: { status: { not: "locked" } }, orderBy: { startedAt: "desc" } }),
    prisma.schedulerRun.findFirst({ where: { status: "ok" }, orderBy: { startedAt: "desc" }, select: { finishedAt: true, startedAt: true } }),
    prisma.schedulerRun.findFirst({ where: { status: "running" }, orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
    prisma.schedulerRun.findMany({ where: { status: "error" }, orderBy: { startedAt: "desc" }, take: 5, select: { id: true, startedAt: true, error: true } }),
  ]);
  const okAt = lastOk ? (lastOk.finishedAt ?? lastOk.startedAt) : null;
  const stale = !okAt || now.getTime() - okAt.getTime() > 2 * SCHEDULER_EXPECTED_INTERVAL_MS;
  const counters: Record<string, number> = {};
  if (last?.counters && typeof last.counters === "object" && !Array.isArray(last.counters)) {
    for (const [k, v] of Object.entries(last.counters)) if (typeof v === "number") counters[k] = v;
  }
  return {
    lastRun: last ? { id: last.id, startedAt: last.startedAt, finishedAt: last.finishedAt, status: last.status, counters, error: errorCategory(last.error) } : null,
    lastSuccessAt: okAt,
    stale,
    lockStuck: !!running && now.getTime() - running.startedAt.getTime() > ROUTE_MAX_DURATION_S * 1000,
    recentErrors: errors.map((e) => ({ id: e.id, startedAt: e.startedAt, error: errorCategory(e.error) })),
  };
}

export async function getMobileAgentQueue(now: Date) {
  const [pending, oldest, handoffs, settings, agents, spend] = await Promise.all([
    prisma.draft.count({ where: { status: "pending" } }),
    prisma.draft.aggregate({ where: { status: "pending" }, _min: { createdAt: true } }),
    prisma.lead.count({ where: { needsHuman: true } }),
    prisma.agentSettings.findUnique({ where: { id: "global" } }),
    prisma.agent.findMany({ orderBy: [{ role: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, role: true, active: true, monthlyBudgetCents: true } }),
    prisma.agentRun.groupBy({ by: ["agentId"], where: { createdAt: { gte: monthStart(now) } }, _sum: { costMicros: true } }),
  ]);
  const view = (spentMicros: number, cap: number | null) => ({
    spentCents: Math.round((spentMicros / MICROS_PER_CENT) * 100) / 100,
    budgetCents: cap,
    budgetState: budgetState(spentMicros, cap),
    percent: cap && cap > 0 ? Math.round((spentMicros / (cap * MICROS_PER_CENT)) * 1000) / 10 : null,
  });
  const spentBy = new Map(spend.map((s) => [s.agentId, s._sum.costMicros ?? 0]));
  const total = spend.reduce((a, s) => a + (s._sum.costMicros ?? 0), 0);
  return {
    drafts: { pending, oldestAt: oldest._min.createdAt },
    handoffs,
    killSwitch: settings?.killSwitch ?? true,
    budget: view(total, settings?.monthlyBudgetCents ?? null),
    agents: agents.map((a) => ({ id: a.id, name: a.name, role: a.role, active: a.active, ...view(spentBy.get(a.id) ?? 0, a.monthlyBudgetCents) })),
  };
}

export async function listMobileSearchRuns(page: { limit: number; cursor?: string }) {
  const rows = await prisma.searchRun.findMany({
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: page.limit + 1,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    select: { id: true, campaignId: true, source: true, trigger: true, status: true, found: true, created: true, duplicate: true, suppressed: true, invalid: true, error: true, startedAt: true, finishedAt: true },
  });
  const items = rows.slice(0, page.limit).map((r) => ({ ...r, error: errorCategory(r.error) }));
  return { items, hasMore: rows.length > page.limit };
}
