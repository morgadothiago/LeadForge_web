import type { InstanceHealth } from "@prisma/client";

/** Teto configurável: default 30, máximo 40 (SPEC-017). */
export const DAILY_LIMIT_DEFAULT = 30;
export const DAILY_LIMIT_MAX = 40;

/** Degraus da rampa: início do degrau (dias completos desde a 1ª conexão) e limite/dia. `null` = teto configurado. */
const RAMP: ReadonlyArray<{ fromDay: number; limit: number | null }> = [
  { fromDay: 0, limit: 3 },   // dias 1-3
  { fromDay: 3, limit: 6 },   // dias 4-7
  { fromDay: 7, limit: 12 },  // semana 2 (dias 8-14)
  { fromDay: 14, limit: 20 }, // semana 3 (dias 15-21)
  { fromDay: 21, limit: null }, // semana 4+ (dia 22+)
];
const DAY_MS = 24 * 3600_000;

/** Dia de aquecimento (1 = dia da 1ª conexão). Sem `warmupStartedAt` -> dia 1. */
export function warmupDay(warmupStartedAt: Date | null | undefined, now: Date): number {
  if (!warmupStartedAt) return 1;
  return Math.max(0, Math.floor((now.getTime() - warmupStartedAt.getTime()) / DAY_MS)) + 1;
}

function stepIndex(day: number): number {
  let idx = 0;
  RAMP.forEach((r, i) => { if (day - 1 >= r.fromDay) idx = i; });
  return idx;
}

/**
 * Limite diário efetivo = min(teto, rampa). `warning` desce um degrau (a rampa só sobe com saúde boa); `paused` = 0.
 * Puro.
 */
export function effectiveDailyLimit(ceiling: number, warmupStartedAt: Date | null | undefined, now: Date, health: InstanceHealth = "good"): number {
  if (health === "paused") return 0;
  const cap = Math.min(Math.max(ceiling, 0), DAILY_LIMIT_MAX);
  let idx = stepIndex(warmupDay(warmupStartedAt, now));
  if (health === "warning") idx = Math.max(0, idx - 1);
  const step = RAMP[idx].limit;
  return step === null ? cap : Math.min(cap, step);
}

/**
 * Novo `warmupStartedAt` ao retomar após pausa: recua UM degrau em relação ao degrau atual (dia 1 do degrau anterior). Puro.
 */
export function stepDownWarmupStart(warmupStartedAt: Date | null | undefined, now: Date): Date {
  const idx = stepIndex(warmupDay(warmupStartedAt, now));
  const prev = Math.max(0, idx - 1);
  return new Date(now.getTime() - RAMP[prev].fromDay * DAY_MS);
}
