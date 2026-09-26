import { areaOfKind, type Area } from "./areas";

/** SPEC-029: tipos/estado PUROS do lado cliente das notificacoes (sem I/O). */
export interface NotificationSummaryState {
  unreadTotal: number;
  byArea: { calendario: number; leads: number; configuracoes: number; aprovacoes: number };
}
export const EMPTY_SUMMARY: NotificationSummaryState = { unreadTotal: 0, byArea: { calendario: 0, leads: 0, configuracoes: 0, aprovacoes: 0 } };

export interface NotificationItem {
  id: string; kind: string; severity: string; title: string; body: string; refType: string; refId: string | null; link: string | null;
  createdAt: string; readAt: string | null; resolvedAt: string | null; area: Area | null;
}

export type NavBadgeKey = Area | "notificacoes";

export function isSummary(v: unknown): v is NotificationSummaryState {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  const a = s.byArea as Record<string, unknown> | undefined;
  return typeof s.unreadTotal === "number" && !!a && ["calendario", "leads", "configuracoes", "aprovacoes"].every((k) => typeof a[k] === "number");
}

export const countFor = (s: NotificationSummaryState, key: NavBadgeKey): number => Math.max(0, key === "notificacoes" ? s.unreadTotal : s.byArea[key]);

/** Marcar uma como lida (otimista): baixa o total e a area do kind (nunca abaixo de 0). aprovacoes nao vem de alertas. */
export function applyMarkRead(s: NotificationSummaryState, kind: string): NotificationSummaryState {
  const area = areaOfKind(kind);
  const dec = (n: number) => Math.max(0, n - 1);
  return { unreadTotal: dec(s.unreadTotal), byArea: area && area !== "aprovacoes" ? { ...s.byArea, [area]: dec(s.byArea[area]) } : s.byArea };
}
/** Marcar todas (otimista): sem area zera o total e as areas de alerta; com area zera so ela e subtrai do total. aprovacoes nunca zera (fila de Draft). */
export function applyMarkAllRead(s: NotificationSummaryState, area?: Area): NotificationSummaryState {
  if (!area) return { unreadTotal: 0, byArea: { ...s.byArea, calendario: 0, leads: 0, configuracoes: 0 } };
  if (area === "aprovacoes") return s;
  return { unreadTotal: Math.max(0, s.unreadTotal - s.byArea[area]), byArea: { ...s.byArea, [area]: 0 } };
}

const REMINDER_TITLE = /^Reunião em (\d+) min$/;
/** Toast so para lembrete de reuniao <= 15 min ("Reuniao em 15 min"/5 min) e ainda nao lido. */
export function shouldToastReminder(n: Pick<NotificationItem, "kind" | "title" | "readAt" | "resolvedAt">): boolean {
  if (n.kind !== "meeting_reminder" || n.readAt || n.resolvedAt) return false;
  const m = REMINDER_TITLE.exec(n.title);
  return !!m && Number(m[1]) <= 15;
}

const UUID = /^[0-9a-f-]{36}$/i;
export function notificationHref(n: Pick<NotificationItem, "kind" | "refType" | "refId" | "area">): string {
  if (n.kind === "meeting_reminder" && n.refId && UUID.test(n.refId)) return `/calendario?meeting=${n.refId}`;
  if (n.refType === "lead" && n.refId && UUID.test(n.refId)) return `/leads/${n.refId}`;
  switch (n.area) {
    case "calendario": return "/calendario";
    case "leads": return "/leads";
    case "configuracoes": return "/configuracoes";
    case "aprovacoes": return "/aprovacoes";
    default: return "/notificacoes";
  }
}

export function relativeTime(iso: string, now: number = Date.now()): string {
  const diffSec = Math.round((Date.parse(iso) - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  const abs = Math.abs(diffSec);
  if (abs < 60) return "agora";
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), "hour");
  return rtf.format(Math.round(diffSec / 86_400), "day");
}

export const bellLabel = (n: number) => (n > 0 ? `Notificações, ${n} não ${n === 1 ? "lida" : "lidas"}` : "Notificações, nenhuma não lida");
export const bellCountText = (n: number) => (n > 99 ? "99+" : String(n));
export const navNewText = (n: number) => `, ${n} ${n === 1 ? "novo item" : "novos itens"}`;
export const navTooltip = (label: string, n: number) => (n > 0 ? `${label} (${n} ${n === 1 ? "novo" : "novos"})` : label);
