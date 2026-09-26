import { AlertTriangle, Bell, CalendarClock, MessageSquare, UserRoundCheck, Wallet, WifiOff, type LucideIcon } from "lucide-react";
import type { NotificationItem } from "@/lib/notifications/client-types";

const ICONS: Record<string, LucideIcon> = {
  meeting_reminder: CalendarClock,
  handoff: UserRoundCheck,
  lead_replied: MessageSquare,
  wa_disconnected: WifiOff,
  wa_paused: WifiOff,
  scheduler_stale: AlertTriangle,
  budget_alert: Wallet,
  budget_exhausted: Wallet,
  mass_opt_out: AlertTriangle,
};

export function KindIcon({ kind, className }: { kind: string; className?: string }) {
  const Icon = ICONS[kind] ?? Bell;
  return <Icon aria-hidden="true" className={className ?? "size-4"} />;
}

export const KIND_LABELS: Record<string, string> = {
  meeting_reminder: "Lembrete de reunião",
  handoff: "Precisa de você",
  lead_replied: "Lead respondeu",
  wa_disconnected: "WhatsApp desconectado",
  wa_paused: "WhatsApp pausado",
  scheduler_stale: "Agendador parado",
  budget_alert: "Alerta de orçamento",
  budget_exhausted: "Orçamento esgotado",
  mass_opt_out: "Descadastros em massa",
};

export const isUnread = (n: Pick<NotificationItem, "readAt">) => !n.readAt;
