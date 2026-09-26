/**
 * SPEC-029: helpers PUROS de dia/hora/semana/mes num fuso explicito (padrao America/Sao_Paulo).
 * Nunca usam o fuso do processo (TZ do servidor/navegador): tudo passa por Intl com `timeZone`.
 * "Dia" e representado por uma chave `YYYY-MM-DD` (calendario civil, sem fuso).
 */
export const CALENDAR_TZ = "America/Sao_Paulo";
export type CalendarView = "month" | "week" | "day";

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function parts(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    fmtCache.set(tz, f);
  }
  return f;
}

export interface ZonedParts { year: number; month: number; day: number; hour: number; minute: number }
export function zonedParts(date: Date, tz: string = CALENDAR_TZ): ZonedParts {
  const o: Record<string, number> = {};
  for (const p of parts(tz).formatToParts(date)) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { year: o.year, month: o.month, day: o.day, hour: o.hour % 24, minute: o.minute };
}

const pad = (n: number) => String(n).padStart(2, "0");
export const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
export const isDayKey = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const utcOf = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (ms: number) => {
  const t = new Date(ms);
  return keyOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
};

export const dayKeyOf = (date: Date, tz: string = CALENDAR_TZ): string => {
  const p = zonedParts(date, tz);
  return keyOf(p.year, p.month, p.day);
};
export const minutesOfDay = (date: Date, tz: string = CALENDAR_TZ): number => {
  const p = zonedParts(date, tz);
  return p.hour * 60 + p.minute;
};
export const addDays = (key: string, n: number): string => fromUtc(utcOf(key) + n * 86_400_000);
/** 0 = segunda ... 6 = domingo. */
export const weekdayIndex = (key: string): number => (new Date(utcOf(key)).getUTCDay() + 6) % 7;
export const weekStartKey = (key: string): string => addDays(key, -weekdayIndex(key));
export const monthStartKey = (key: string): string => `${key.slice(0, 7)}-01`;
export const addMonths = (key: string, n: number): string => {
  const [y, m] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return keyOf(t.getUTCFullYear(), t.getUTCMonth() + 1, 1);
};
export const daysBetween = (a: string, b: string) => Math.round((utcOf(b) - utcOf(a)) / 86_400_000);

/** Instante (UTC) em que o relogio de `tz` marca `minutes` (0..1440) no dia `key`. Resolve a virada de offset iterando. */
export function instantAt(key: string, minutes: number, tz: string = CALENDAR_TZ): Date {
  const wall = utcOf(key) + minutes * 60_000;
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(guess), tz);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const diff = wall - seen;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

/** 42 dias (6x7) da grade do mes, iniciando na segunda. */
export function monthGridKeys(key: string): string[] {
  const start = weekStartKey(monthStartKey(key));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
export const weekKeys = (key: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(weekStartKey(key), i));

/** Intervalo visivel [from, to) meia-aberto, em ISO (<= 62 dias). */
export function visibleRange(view: CalendarView, key: string, tz: string = CALENDAR_TZ): { from: string; to: string; days: string[] } {
  const days = view === "month" ? monthGridKeys(key) : view === "week" ? weekKeys(key) : [key];
  return { from: instantAt(days[0], 0, tz).toISOString(), to: instantAt(addDays(days[days.length - 1], 1), 0, tz).toISOString(), days };
}

export function shiftDate(view: CalendarView, key: string, dir: -1 | 1): string {
  return view === "month" ? addMonths(key, dir) : addDays(key, dir * (view === "week" ? 7 : 1));
}

export interface Segment { startMin: number; endMin: number }
/** Recorte de uma reuniao dentro de um dia (0..1440); null se nao toca o dia. Reuniao que cruza a meia-noite vira um segmento por dia. */
export function segmentForDay(startsAt: Date, endsAt: Date, key: string, tz: string = CALENDAR_TZ): Segment | null {
  const dayStart = instantAt(key, 0, tz).getTime();
  const dayEnd = instantAt(addDays(key, 1), 0, tz).getTime();
  const s = startsAt.getTime();
  const e = Math.max(endsAt.getTime(), s);
  if (s >= dayEnd || e < dayStart || (e === dayStart && e > s)) return null;
  const toMin = (ms: number) => Math.round((ms - dayStart) / 60_000);
  return { startMin: Math.max(0, toMin(s)), endMin: Math.min(1440, toMin(e)) };
}

export interface Ranged { id: string; startsAt: Date; endsAt: Date }
export function groupByDay<T extends Ranged>(items: T[], days: string[], tz: string = CALENDAR_TZ): Map<string, { item: T; seg: Segment }[]> {
  const out = new Map<string, { item: T; seg: Segment }[]>(days.map((d) => [d, []]));
  for (const item of items) {
    for (const d of days) {
      const seg = segmentForDay(item.startsAt, item.endsAt, d, tz);
      if (seg) out.get(d)!.push({ item, seg });
    }
  }
  return out;
}

/** Reunioes (nao canceladas, quando `status` existe) que se sobrepoem a [startsAt, endsAt). */
export function findConflicts<T extends Ranged & { status?: string }>(items: T[], startsAt: Date, endsAt: Date, excludeId?: string): T[] {
  return items.filter((m) => m.id !== excludeId && (m.status === undefined || m.status === "scheduled") && m.startsAt < endsAt && m.endsAt > startsAt);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const dateFmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", ...opts });
const noon = (key: string) => new Date(utcOf(key) + 12 * 3_600_000);
export const formatTime = (date: Date, tz: string = CALENDAR_TZ) => new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
export const formatDayLong = (key: string) => cap(dateFmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(noon(key)));
export const formatDayShort = (key: string) => cap(dateFmt({ weekday: "short", day: "2-digit", month: "short" }).format(noon(key)).replace(/\./g, ""));
export const formatWeekday = (key: string) => cap(dateFmt({ weekday: "short" }).format(noon(key)).replace(/\./g, ""));
export const formatMonthTitle = (key: string) => cap(dateFmt({ month: "long", year: "numeric" }).format(noon(key)));
export const formatMinutes = (min: number) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
export function viewTitle(view: CalendarView, key: string): string {
  if (view === "month") return formatMonthTitle(key);
  if (view === "day") return formatDayLong(key);
  const w = weekKeys(key);
  const f = dateFmt({ day: "numeric", month: "short" });
  return `${f.format(noon(w[0])).replace(/\./g, "")} – ${f.format(noon(w[6])).replace(/\./g, "")} de ${w[6].slice(0, 4)}`;
}
