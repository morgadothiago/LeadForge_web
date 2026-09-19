const DEFAULT_TZ = "America/Sao_Paulo";
export const WINDOW_START_HOUR = 8;
export const WINDOW_END_HOUR = 18;

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

/** 8h <= hora local < 18h no fuso IANA do lead (fallback America/Sao_Paulo). */
export function isWithinSendWindow(timezone: string | null | undefined, now: Date = new Date()): boolean {
  const { h } = parts(resolveTimezone(timezone), now);
  return h >= WINDOW_START_HOUR && h < WINDOW_END_HOUR;
}

/** Próximo início de janela (08:00 local): hora local < 8 -> hoje 08:00; senão -> amanhã 08:00. */
export function nextWindowStart(timezone: string | null | undefined, now: Date = new Date()): Date {
  const tz = resolveTimezone(timezone);
  const p = parts(tz, now);
  const dayOffset = p.h < WINDOW_START_HOUR ? 0 : 1;
  // Date.UTC normaliza estouro de dia/mês.
  const base = new Date(Date.UTC(p.y, p.mo - 1, p.d + dayOffset));
  return wallToUtc(tz, base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), WINDOW_START_HOUR);
}

/** `t` se já cair na janela, senão o próximo início de janela. */
export function earliestInWindow(timezone: string | null | undefined, t: Date): Date {
  return isWithinSendWindow(timezone, t) ? t : nextWindowStart(timezone, t);
}
