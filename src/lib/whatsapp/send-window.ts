import { isBrazilianHoliday } from "./holidays";

const DEFAULT_TZ = "America/Sao_Paulo";
/**
 * SPEC-017 (substitui a janela 8h-18h da SPEC-011): seg-sex, 9h-12h e 14h-17h no fuso do lead, exceto feriados nacionais.
 * Intervalos semiabertos [início, fim) em hora cheia local.
 */
export const SEND_WINDOWS: ReadonlyArray<readonly [number, number]> = [[9, 12], [14, 17]];
export const WINDOW_START_HOUR = 9;
export const WINDOW_END_HOUR = 17;

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = cache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    cache.set(tz, f);
  }
  return f;
}

/** Fuso IANA válido, senão America/Sao_Paulo. */
export function resolveTimezone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TZ;
  try {
    fmt(tz);
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

function parts(tz: string, at: Date) {
  const o: Record<string, number> = {};
  for (const p of fmt(tz).formatToParts(at)) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o.year, mo: o.month, d: o.day, h: o.hour, mi: o.minute, s: o.second };
}
function offsetMs(tz: string, at: Date): number {
  const p = parts(tz, at);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(at.getTime() / 1000) * 1000;
}
/** Instante UTC de um horário de parede (y-mo-d h:00) no fuso. */
function wallToUtc(tz: string, y: number, mo: number, d: number, h: number): Date {
  const guess = Date.UTC(y, mo - 1, d, h);
  const first = guess - offsetMs(tz, new Date(guess));
  const second = guess - offsetMs(tz, new Date(first));
  return new Date(second);
}

/** Data local (y, mo, d) do instante no fuso. */
export function localDate(timezone: string | null | undefined, at: Date): { y: number; mo: number; d: number; h: number; weekday: number } {
  const p = parts(resolveTimezone(timezone), at);
  return { y: p.y, mo: p.mo, d: p.d, h: p.h, weekday: new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay() };
}

/** Dia útil = seg-sex e não feriado nacional (na data LOCAL do lead). */
export function isBusinessDay(y: number, mo: number, d: number): boolean {
  const wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return wd !== 0 && wd !== 6 && !isBrazilianHoliday(y, mo, d);
}

/** Dentro da janela seg-sex 9-12 / 14-17 (hora local) e fora de feriado nacional. */
export function isWithinSendWindow(timezone: string | null | undefined, now: Date = new Date()): boolean {
  const l = localDate(timezone, now);
  if (!isBusinessDay(l.y, l.mo, l.d)) return false;
  return SEND_WINDOWS.some(([a, b]) => l.h >= a && l.h < b);
}

/** Primeiro início de janela ESTRITAMENTE depois de `now` (9h ou 14h de um dia útil local). */
export function nextWindowStart(timezone: string | null | undefined, now: Date = new Date()): Date {
  const tz = resolveTimezone(timezone);
  const p = parts(tz, now);
  for (let off = 0; off < 30; off++) {
    // Date.UTC normaliza estouro de dia/mês.
    const base = new Date(Date.UTC(p.y, p.mo - 1, p.d + off));
    const y = base.getUTCFullYear(), mo = base.getUTCMonth() + 1, d = base.getUTCDate();
    if (!isBusinessDay(y, mo, d)) continue;
    for (const [start] of SEND_WINDOWS) {
      const at = wallToUtc(tz, y, mo, d, start);
      if (at.getTime() > now.getTime()) return at;
    }
  }
  return new Date(now.getTime() + 24 * 3600_000);
}

/** `t` se já cair na janela, senão o próximo início de janela. */
export function earliestInWindow(timezone: string | null | undefined, t: Date): Date {
  return isWithinSendWindow(timezone, t) ? t : nextWindowStart(timezone, t);
}

/** Início (00:00 local) do dia civil do instante, no fuso. */
export function startOfLocalDay(timezone: string | null | undefined, at: Date): Date {
  const tz = resolveTimezone(timezone);
  const p = parts(tz, at);
  return wallToUtc(tz, p.y, p.mo, p.d, 0);
}
/** Início do dia local seguinte. */
export function startOfNextLocalDay(timezone: string | null | undefined, at: Date): Date {
  const tz = resolveTimezone(timezone);
  const p = parts(tz, at);
  const base = new Date(Date.UTC(p.y, p.mo - 1, p.d + 1));
  return wallToUtc(tz, base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), 0);
}
