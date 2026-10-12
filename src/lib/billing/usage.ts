import { randomUUID } from "node:crypto";
import type { LimitMetric, Db, OrgLimits } from "./limits";
import { PlanLimitError, getOrgLimits, limitFor } from "./limits";

/**
 * SPEC-065 (D-065-17) — contador de FLUXO (leads, envios) por organizacao, atomico e independente das linhas de negocio: apagar um
 * lead NAO devolve cota. `reserveUsage` e um unico `INSERT ... ON CONFLICT DO UPDATE ... WHERE count + n <= limite RETURNING`:
 * sob concorrencia o Postgres serializa na linha do contador (a condicao e reavaliada apos o lock), entao `Promise.all` com cota 1
 * reserva exatamente 1. Dentro de uma transacao, o rollback devolve a reserva.
 */

const TZ = "America/Sao_Paulo";

function brtParts(now: Date): { y: string; m: string; d: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** `YYYY-MM-DD` no fuso America/Sao_Paulo. */
export function dayKey(now: Date): string {
  const { y, m, d } = brtParts(now);
  return `${y}-${m}-${d}`;
}

/** `YYYY-MM` no fuso America/Sao_Paulo. */
export function monthKey(now: Date): string {
  const { y, m } = brtParts(now);
  return `${y}-${m}`;
}

/** Janela de leads (D-065-17b): `trial` (fixa) enquanto `trialing`; mes civil BRT no plano pago. */
export function leadsPeriodKey(limits: Pick<OrgLimits, "trialing">, now: Date): string {
  return limits.trialing ? "trial" : monthKey(now);
}

export type UsageMetric = Extract<LimitMetric, "leads" | "sends">;

/** Proxima meia-noite BRT apos `now` (+1 min de folga) — quando o contador diario zera. */
export function nextBrtDayStart(now: Date): Date {
  // BRT = UTC-3 (sem horario de verao desde 2019). Meia-noite BRT = 03:00 UTC.
  const { y, m, d } = brtParts(now);
  const midnightUtc = Date.UTC(Number(y), Number(m) - 1, Number(d), 3, 0, 0);
  return new Date(midnightUtc + 24 * 3600_000 + 60_000);
}

/**
 * Reserva `n` unidades. `limit === null` = ilimitado (nada gravado). Devolve `{ ok:true, used }` ou `{ ok:false, used }` (limite).
 * `used` = contagem apos a reserva (ok) ou contagem atual (falha).
 */
export async function reserveUsage(db: Db, orgId: string, metric: UsageMetric, periodKey: string, n: number, limit: number | null): Promise<{ ok: true; used: number } | { ok: false; used: number }> {
  if (limit === null) return { ok: true, used: 0 };
  if (n > limit) return { ok: false, used: await currentUsage(db, orgId, metric, periodKey) };
  const rows = await db.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "UsageCounter" ("id", "orgId", "metric", "periodKey", "count", "updatedAt")
    VALUES (${randomUUID()}, ${orgId}, ${metric}, ${periodKey}, ${n}::int, now())
    ON CONFLICT ("orgId", "metric", "periodKey")
    DO UPDATE SET "count" = "UsageCounter"."count" + ${n}::int, "updatedAt" = now()
    WHERE "UsageCounter"."count" + ${n}::int <= ${limit}::int
    RETURNING "count"`;
  if (rows.length === 0) return { ok: false, used: await currentUsage(db, orgId, metric, periodKey) };
  return { ok: true, used: Number(rows[0].count) };
}

export async function currentUsage(db: Db, orgId: string, metric: UsageMetric, periodKey: string): Promise<number> {
  const row = await db.usageCounter.findUnique({ where: { orgId_metric_periodKey: { orgId, metric, periodKey } }, select: { count: true } });
  return row?.count ?? 0;
}

/** Atalho para fluxos de leads: reserva 1 lead na janela correta e lanca `PlanLimitError` se estourou. Dentro da transacao do insert. */
export async function reserveLeadOrThrow(db: Db, orgId: string, now: Date, n = 1): Promise<void> {
  const limits = await getOrgLimits(db, orgId);
  const limit = limitFor(limits, "leads");
  if (limit === null) return;
  const r = await reserveUsage(db, orgId, "leads", leadsPeriodKey(limits, now), n, limit);
  if (!r.ok) throw new PlanLimitError("leads", limit, r.used);
}
