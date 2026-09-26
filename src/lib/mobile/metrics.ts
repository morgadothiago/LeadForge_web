import { Prisma, type CampaignStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";
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

/**
 * SPEC-022: servicos de leitura agregada para o app. SEM requireUser (o guard e requireMobile na rota). Somente agregados, sem PII.
 * SPEC-030: toda funcao aqui recebe `orgId` (resolvido pela rota via `resolveOrgId(a.userId)`, `src/lib/mobile/org.ts`)
 * e escopa TODAS as leituras por org — nenhuma agregacao cross-tenant.
 */

const DAY = 24 * 3600_000;
/** null quando o denominador e 0 (nunca NaN/0). */
export const rate = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 1000) / 1000 : null);

/** contatados (leads distintos com envio outbound na janela) e respondidos (desses, com inbound na janela) DESTA org; subselect escalar. */
const contactSql = (orgId: string, from: Date, to: Date, responded: boolean) =>
  responded
    ? Prisma.sql`(SELECT COUNT(DISTINCT o."leadId") FROM "Touch" o JOIN "Lead" ld ON ld.id = o."leadId" JOIN "Campaign" cp ON cp.id = ld."campaignId" WHERE cp."orgId" = ${orgId} AND o.direction = 'outbound' AND o."sentAt" >= ${from} AND o."sentAt" < ${to} AND EXISTS (SELECT 1 FROM "Touch" i WHERE i."leadId" = o."leadId" AND i.direction = 'inbound' AND i."createdAt" >= ${from} AND i."createdAt" < ${to}))`
    : Prisma.sql`(SELECT COUNT(DISTINCT o."leadId") FROM "Touch" o JOIN "Lead" ld ON ld.id = o."leadId" JOIN "Campaign" cp ON cp.id = ld."campaignId" WHERE cp."orgId" = ${orgId} AND o.direction = 'outbound' AND o."sentAt" >= ${from} AND o."sentAt" < ${to})`;
/** Contagem por intervalo, escopada por org. `join` é o caminho até `Campaign` ("" para tabelas com orgId direto). */
const rangeCount = (orgId: string, table: string, col: string, from: Date, to: Date, extra: Prisma.Sql = Prisma.empty) => {
  const t = Prisma.raw(`"${table}"`);
  const c = Prisma.raw(`"${col}"`);
  if (table === "Lead")
    return Prisma.sql`(SELECT COUNT(*) FROM ${t} x JOIN "Campaign" cp ON cp.id = x."campaignId" WHERE cp."orgId" = ${orgId} AND x.${c} >= ${from} AND x.${c} < ${to} ${extra})`;
  if (table === "Touch")
    return Prisma.sql`(SELECT COUNT(*) FROM ${t} x JOIN "Lead" ld ON ld.id = x."leadId" JOIN "Campaign" cp ON cp.id = ld."campaignId" WHERE cp."orgId" = ${orgId} AND x.${c} >= ${from} AND x.${c} < ${to} ${extra})`;
  if (table === "Meeting")
    return Prisma.sql`(SELECT COUNT(*) FROM ${t} x JOIN "Campaign" cp ON cp.id = x."campaignId" WHERE cp."orgId" = ${orgId} AND x.${c} >= ${from} AND x.${c} < ${to} ${extra})`;
  // Suppression: orgId direto.
  return Prisma.sql`(SELECT COUNT(*) FROM ${t} x WHERE x."orgId" = ${orgId} AND x.${c} >= ${from} AND x.${c} < ${to} ${extra})`;
};

/**
 * AC7: /summary faz 3 queries (1 SELECT com todos os contadores como subselects escalares + 1 findMany de instancias para o limite efetivo).
 * Mesmas regras de getMetrics (lead novo, follow-up via StageHistory, resposta = Touch inbound, reuniao) e dos demais contadores.
 */
export async function getMobileSummary(orgId: string, period: "7d" | "30d", now: Date) {
  const ranges = getPeriodRanges(now, period);
  const { current: c, previous: p } = ranges;
  const today = startOfDaySP(now);
  const tomorrow = new Date(today.getTime() + DAY);
  const since24h = new Date(now.getTime() - DAY);
  const [rows, waInst] = await Promise.all([
    prisma.$queryRaw<Record<string, bigint | null>[]>`
      SELECT
        ${rangeCount(orgId, "Lead", "createdAt", c.from, c.to)} AS "newC", ${rangeCount(orgId, "Lead", "createdAt", p.from, p.to)} AS "newP",
        ${rangeCount(orgId, "Touch", "createdAt", c.from, c.to, Prisma.sql`AND x.direction = 'inbound'`)} AS "repC", ${rangeCount(orgId, "Touch", "createdAt", p.from, p.to, Prisma.sql`AND x.direction = 'inbound'`)} AS "repP",
        ${rangeCount(orgId, "Meeting", "createdAt", c.from, c.to, Prisma.sql`AND x.status <> 'cancelled'`)} AS "meetC", ${rangeCount(orgId, "Meeting", "createdAt", p.from, p.to, Prisma.sql`AND x.status <> 'cancelled'`)} AS "meetP",
        ${rangeCount(orgId, "Suppression", "createdAt", c.from, c.to)} AS "optC", ${rangeCount(orgId, "Suppression", "createdAt", p.from, p.to)} AS "optP",
        ${contactSql(orgId, c.from, c.to, false)} AS "conC", ${contactSql(orgId, p.from, p.to, false)} AS "conP", ${contactSql(orgId, c.from, c.to, true)} AS "resC",
        (SELECT COUNT(*) FROM "Touch" x JOIN "Lead" ld ON ld.id = x."leadId" JOIN "Campaign" cp ON cp.id = ld."campaignId" WHERE cp."orgId" = ${orgId} AND x.direction = 'outbound' AND x.channel = 'whatsapp' AND x."sentAt" >= ${today} AND x."sentAt" < ${tomorrow}) AS "waSent",
        (SELECT COUNT(*) FROM "Touch" x JOIN "Lead" ld ON ld.id = x."leadId" JOIN "Campaign" cp ON cp.id = ld."campaignId" WHERE cp."orgId" = ${orgId} AND x.direction = 'outbound' AND x.channel = 'email' AND x."sentAt" >= ${today} AND x."sentAt" < ${tomorrow}) AS "emSent",
        (SELECT COALESCE(SUM("dailyLimit"), 0) FROM "EmailAccount" WHERE "orgId" = ${orgId} AND "isActive" = true) AS "emLimit",
        (SELECT COUNT(*) FROM "Touch" x JOIN "Lead" ld ON ld.id = x."leadId" JOIN "Campaign" cp ON cp.id = ld."campaignId" WHERE cp."orgId" = ${orgId} AND x.direction = 'outbound' AND x.status = 'failed' AND x."updatedAt" >= ${since24h}) AS "fail",
        (SELECT COUNT(*) FROM "InstanceAlert" ia JOIN "WhatsAppInstance" wi ON wi.id = ia."instanceId" WHERE wi."orgId" = ${orgId} AND ia."readAt" IS NULL) AS "unread",
        (SELECT COUNT(*) FROM "Lead" x JOIN "Campaign" cp ON cp.id = x."campaignId" WHERE cp."orgId" = ${orgId} AND x."needsHuman" = true) AS "handoffs",
        (SELECT COUNT(*) FROM "Draft" d JOIN "Lead" ld ON ld.id = d."leadId" JOIN "Campaign" cp ON cp.id = ld."campaignId" WHERE cp."orgId" = ${orgId} AND d.status = 'pending') AS "drafts"`,
    prisma.whatsAppInstance.findMany({ where: { orgId }, select: { id: true, dailyLimit: true, warmupStartedAt: true, health: true } }),
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

export async function getMobilePipeline(orgId: string) {
  const g: { stage: string; _count: { _all: number }; _sum: { value: number | null } }[] = await scopedPrisma(orgId).opportunity.groupBy({ by: ["stage"], _count: { _all: true }, _sum: { value: true } });
  return STAGES.map((stage) => {
    const r = g.find((x) => x.stage === stage);
    return { stage, label: STAGE_LABELS[stage], count: r?._count._all ?? 0, totalValue: r?._sum.value ?? 0 };
  });
}

interface CampStats { sent: number; replies: number; activeLeads: number; nextSendAt: Date | null }
/** `ids` já vêm de uma query escopada por org (findMany/groupBy abaixo) — o join por `campaignId` aqui é seguro. */
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

export async function listMobileCampaigns(orgId: string, status: CampaignStatus, page: { limit: number; cursor?: string }) {
  const rows = await scopedPrisma(orgId).campaign.findMany({
    where: { status },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: page.limit + 1,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    select: { id: true, name: true, status: true },
  });
  const items = rows.slice(0, page.limit);
  const stats = await campaignStats(items.map((c: { id: string }) => c.id));
  return { items: items.map((c: { id: string; name: string; status: CampaignStatus }) => campView(c, stats.get(c.id)!)), hasMore: rows.length > page.limit };
}

export async function getMobileCampaign(orgId: string, id: string, now: Date) {
  const c = await scopedPrisma(orgId).campaign.findUnique({ where: { id }, select: { id: true, name: true, status: true } });
  if (!c) return null;
  const start0 = new Date(startOfDaySP(now).getTime() - 6 * DAY);
  const [stats, touches] = await Promise.all([
    campaignStats([id]),
    scopedPrisma(orgId).touch.findMany({
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

export async function getMobileInstances(orgId: string, now: Date) {
  const insts = await prisma.whatsAppInstance.findMany({ where: { orgId }, orderBy: { createdAt: "asc" }, take: 50 });
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

export async function getMobileScheduler(orgId: string, now: Date) {
  const [last, lastOk, running, errors] = await Promise.all([
    prisma.schedulerRun.findFirst({ where: { orgId, status: { not: "locked" } }, orderBy: { startedAt: "desc" } }),
    prisma.schedulerRun.findFirst({ where: { orgId, status: "ok" }, orderBy: { startedAt: "desc" }, select: { finishedAt: true, startedAt: true } }),
    prisma.schedulerRun.findFirst({ where: { orgId, status: "running" }, orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
    prisma.schedulerRun.findMany({ where: { orgId, status: "error" }, orderBy: { startedAt: "desc" }, take: 5, select: { id: true, startedAt: true, error: true } }),
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

export async function getMobileAgentQueue(orgId: string, now: Date) {
  const db = scopedPrisma(orgId);
  const [pending, oldest, handoffs, settings, agents, spend] = await Promise.all([
    db.draft.count({ where: { status: "pending" } }),
    db.draft.aggregate({ where: { status: "pending" }, _min: { createdAt: true } }),
    db.lead.count({ where: { needsHuman: true } }),
    prisma.agentSettings.findUnique({ where: { orgId } }),
    db.agent.findMany({ orderBy: [{ role: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, role: true, active: true, monthlyBudgetCents: true } }),
    db.agentRun.groupBy({ by: ["agentId"], where: { createdAt: { gte: monthStart(now) } }, _sum: { costMicros: true } }),
  ]);
  const view = (spentMicros: number, cap: number | null) => ({
    spentCents: Math.round((spentMicros / MICROS_PER_CENT) * 100) / 100,
    budgetCents: cap,
    budgetState: budgetState(spentMicros, cap),
    percent: cap && cap > 0 ? Math.round((spentMicros / (cap * MICROS_PER_CENT)) * 1000) / 10 : null,
  });
  type Spend = { agentId: string; _sum: { costMicros: number | null } };
  const spendRows = spend as Spend[];
  const spentBy = new Map(spendRows.map((s) => [s.agentId, s._sum.costMicros ?? 0]));
  const total = spendRows.reduce((a, s) => a + (s._sum.costMicros ?? 0), 0);
  type AgentRow = { id: string; name: string; role: string; active: boolean; monthlyBudgetCents: number | null };
  return {
    drafts: { pending, oldestAt: oldest._min.createdAt },
    handoffs,
    killSwitch: settings?.killSwitch ?? true,
    budget: view(total, settings?.monthlyBudgetCents ?? null),
    agents: (agents as AgentRow[]).map((a) => ({ id: a.id, name: a.name, role: a.role, active: a.active, ...view(spentBy.get(a.id) ?? 0, a.monthlyBudgetCents) })),
  };
}

export async function listMobileSearchRuns(orgId: string, page: { limit: number; cursor?: string }) {
  const rows = await scopedPrisma(orgId).searchRun.findMany({
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: page.limit + 1,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    select: { id: true, campaignId: true, source: true, trigger: true, status: true, found: true, created: true, duplicate: true, suppressed: true, invalid: true, error: true, startedAt: true, finishedAt: true },
  });
  type Row = { id: string; campaignId: string; source: string; trigger: string; status: string; found: number; created: number; duplicate: number; suppressed: number; invalid: number; error: string | null; startedAt: Date; finishedAt: Date | null };
  const items = (rows as Row[]).slice(0, page.limit).map((r) => ({ ...r, error: errorCategory(r.error) }));
  return { items, hasMore: rows.length > page.limit };
}
