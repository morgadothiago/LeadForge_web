import type { WhatsAppInstance } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HEALTH, buildHealthMetrics, computeHealthMetrics, decideHealth, type HealthMetrics, type SendRow } from "./health";
import { effectiveDailyLimit, warmupDay } from "./warmup";
import { startOfDaySP } from "@/lib/channels/email";
import type { InstanceHealthView } from "@/lib/queries/whatsapp-health";

/** Sem auth: chamada pelo guard mobile (SPEC-022) e por getInstanceHealth. */
export async function buildInstanceHealthView(inst: WhatsAppInstance, now: Date): Promise<InstanceHealthView> {
  const since = startOfDaySP(now);
  const [metrics, sentToday, alerts] = await Promise.all([
    computeHealthMetrics(inst.id, now),
    prisma.touch.count({ where: { whatsappInstanceId: inst.id, channel: "whatsapp", direction: "outbound", sentAt: { gte: since, lt: new Date(since.getTime() + 24 * 3600_000) } } }),
    prisma.instanceAlert.findMany({ where: { instanceId: inst.id }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  return {
    instanceId: inst.id,
    state: inst.health,
    pausedUntil: inst.pausedUntil,
    pausedReason: inst.pausedReason,
    warmupDay: inst.warmupStartedAt ? warmupDay(inst.warmupStartedAt, now) : null,
    dailyLimitCeiling: inst.dailyLimit,
    effectiveLimitToday: effectiveDailyLimit(inst.dailyLimit, inst.warmupStartedAt, now, inst.health),
    sentToday,
    metrics,
    warnings: decideHealth(metrics).warnings,
    alerts: alerts.map(({ id, kind, message, createdAt, readAt }) => ({ id, kind, message, createdAt, readAt })),
  };
}


type AlertRow = InstanceHealthView["alerts"][number];

/**
 * Versao EM LOTE (SPEC-022, AC7): numero CONSTANTE de queries (5) para N instancias, mesma regra de buildInstanceHealthView.
 * Janela por instancia = max(7 dias, healthResetAt); ultimos 50 envios, 5 ultimas atualizacoes e 10 alertas por instancia via ROW_NUMBER.
 */
export async function buildInstanceHealthViews(insts: WhatsAppInstance[], now: Date): Promise<InstanceHealthView[]> {
  if (!insts.length) return [];
  const ids = insts.map((i) => i.id);
  const since = startOfDaySP(now);
  const weekAgo = new Date(now.getTime() - HEALTH.WINDOW_DAYS * 24 * 3600_000);
  const [sendRows, recentRows, inboundRows, sentGroups, alertRows] = await Promise.all([
    prisma.$queryRaw<{ iid: string; status: string; leadId: string; sentAt: Date; opted: boolean; popt: boolean }[]>`
      SELECT iid, status::text AS status, "leadId", "sentAt", opted, popt FROM (
        SELECT t."whatsappInstanceId" AS iid, t.status, t."leadId", t."sentAt",
               (l."optedOutAt" IS NOT NULL) AS opted, COALESCE(l."possibleOptOut", false) AS popt,
               ROW_NUMBER() OVER (PARTITION BY t."whatsappInstanceId" ORDER BY t."sentAt" DESC) AS rn
        FROM "Touch" t JOIN "Lead" l ON l.id = t."leadId" JOIN "WhatsAppInstance" w ON w.id = t."whatsappInstanceId"
        WHERE t."whatsappInstanceId" = ANY(${ids}::text[]) AND t.channel = 'whatsapp' AND t.direction = 'outbound'
          AND t."sentAt" IS NOT NULL AND t."sentAt" >= ${weekAgo} AND (w."healthResetAt" IS NULL OR t."sentAt" >= w."healthResetAt")
      ) x WHERE rn <= ${HEALTH.WINDOW_SENDS} ORDER BY iid, "sentAt" DESC`,
    prisma.$queryRaw<{ iid: string; status: string }[]>`
      SELECT iid, status::text AS status FROM (
        SELECT t."whatsappInstanceId" AS iid, t.status, t."updatedAt",
               ROW_NUMBER() OVER (PARTITION BY t."whatsappInstanceId" ORDER BY t."updatedAt" DESC) AS rn
        FROM "Touch" t JOIN "WhatsAppInstance" w ON w.id = t."whatsappInstanceId"
        WHERE t."whatsappInstanceId" = ANY(${ids}::text[]) AND t.channel = 'whatsapp' AND t.direction = 'outbound'
          AND t.status IN ('sent', 'delivered', 'failed') AND t."updatedAt" >= ${weekAgo} AND (w."healthResetAt" IS NULL OR t."updatedAt" >= w."healthResetAt")
      ) x WHERE rn <= 5 ORDER BY iid, "updatedAt" DESC`,
    prisma.$queryRaw<{ iid: string; n: bigint }[]>`
      SELECT t."whatsappInstanceId" AS iid, COUNT(*) AS n
      FROM "Touch" t JOIN "WhatsAppInstance" w ON w.id = t."whatsappInstanceId"
      WHERE t."whatsappInstanceId" = ANY(${ids}::text[]) AND t.channel = 'whatsapp' AND t.direction = 'inbound'
        AND t."createdAt" >= ${weekAgo} AND (w."healthResetAt" IS NULL OR t."createdAt" >= w."healthResetAt")
      GROUP BY t."whatsappInstanceId"`,
    prisma.touch.groupBy({
      by: ["whatsappInstanceId"],
      where: { whatsappInstanceId: { in: ids }, channel: "whatsapp", direction: "outbound", sentAt: { gte: since, lt: new Date(since.getTime() + 24 * 3600_000) } },
      _count: { _all: true },
    }),
    prisma.$queryRaw<{ id: string; instanceId: string; kind: string; message: string; createdAt: Date; readAt: Date | null }[]>`
      SELECT id, "instanceId", kind::text AS kind, message, "createdAt", "readAt" FROM (
        SELECT a.*, ROW_NUMBER() OVER (PARTITION BY a."instanceId" ORDER BY a."createdAt" DESC) AS rn
        FROM "InstanceAlert" a WHERE a."instanceId" = ANY(${ids}::text[])
      ) x WHERE rn <= 10 ORDER BY "instanceId", "createdAt" DESC`,
  ]);
  const sends = new Map<string, SendRow[]>();
  for (const r of sendRows) {
    const l = sends.get(r.iid) ?? [];
    l.push({ status: r.status, leadId: r.leadId, sentAt: r.sentAt, lead: { optedOutAt: r.opted ? r.sentAt : null, possibleOptOut: r.popt } });
    sends.set(r.iid, l);
  }
  const recent = new Map<string, string[]>();
  for (const r of recentRows) recent.set(r.iid, [...(recent.get(r.iid) ?? []), r.status]);
  const inbound = new Map(inboundRows.map((r) => [r.iid, Number(r.n)]));
  const sentToday = new Map(sentGroups.map((g) => [g.whatsappInstanceId, g._count._all]));
  const alerts = new Map<string, AlertRow[]>();
  for (const a of alertRows) alerts.set(a.instanceId, [...(alerts.get(a.instanceId) ?? []), { id: a.id, kind: a.kind, message: a.message, createdAt: a.createdAt, readAt: a.readAt }]);
  return insts.map((inst) => {
    const s = sends.get(inst.id) ?? [];
    const metrics: HealthMetrics = buildHealthMetrics(s, recent.get(inst.id) ?? [], s.length ? (inbound.get(inst.id) ?? 0) : 0, now);
    return {
      instanceId: inst.id,
      state: inst.health,
      pausedUntil: inst.pausedUntil,
      pausedReason: inst.pausedReason,
      warmupDay: inst.warmupStartedAt ? warmupDay(inst.warmupStartedAt, now) : null,
      dailyLimitCeiling: inst.dailyLimit,
      effectiveLimitToday: effectiveDailyLimit(inst.dailyLimit, inst.warmupStartedAt, now, inst.health),
      sentToday: sentToday.get(inst.id) ?? 0,
      metrics,
      warnings: decideHealth(metrics).warnings,
      alerts: alerts.get(inst.id) ?? [],
    };
  });
}
