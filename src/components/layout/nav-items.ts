import { Bell, CalendarDays, Kanban, ClipboardCheck, LayoutDashboard, Megaphone, Settings, Users, Workflow, type LucideIcon } from "lucide-react";

import type { NavBadgeKey } from "@/lib/notifications/client-types";

export interface NavItem {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Chave do contador "novo" (bolinha) em `NotificationSummaryState`; ausente = sem bolinha. */
  badgeKey?: NavBadgeKey;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", description: "Visão geral das métricas de prospecção.", icon: LayoutDashboard },
  { href: "/pipeline", label: "Pipeline", description: "Acompanhe leads por etapa do funil.", icon: Kanban },
  { href: "/calendario", label: "Calendário", description: "Reuniões agendadas por dia, semana e mês.", icon: CalendarDays, badgeKey: "calendario" },
  { href: "/leads", label: "Leads", description: "Lista e detalhes dos seus leads.", icon: Users, badgeKey: "leads" },
  { href: "/campanhas", label: "Campanhas", description: "Gerencie campanhas e ICPs.", icon: Megaphone },
  { href: "/sequences", label: "Sequences", description: "Monte cadências de contato.", icon: Workflow },
  { href: "/aprovacoes", label: "Aprovações", description: "Revise rascunhos dos agentes de IA.", icon: ClipboardCheck, badgeKey: "aprovacoes" },
  { href: "/notificacoes", label: "Notificações", description: "Alertas e lembretes do sistema.", icon: Bell, badgeKey: "notificacoes" },
  { href: "/configuracoes", label: "Configurações", description: "Contas de envio e integrações.", icon: Settings, badgeKey: "configuracoes" },
];

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getPageTitle(pathname: string): string {
  return NAV_ITEMS.find((i) => isActivePath(pathname, i.href))?.label ?? "LeadForge";
}
