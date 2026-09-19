import { Kanban, LayoutDashboard, Megaphone, Users, Workflow, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Dashboard", description: "Visão geral das métricas de prospecção.", icon: LayoutDashboard },
  { href: "/pipeline", label: "Pipeline", description: "Acompanhe leads por etapa do funil.", icon: Kanban },
  { href: "/leads", label: "Leads", description: "Lista e detalhes dos seus leads.", icon: Users },
  { href: "/campanhas", label: "Campanhas", description: "Gerencie campanhas e ICPs.", icon: Megaphone },
  { href: "/sequences", label: "Sequences", description: "Monte cadências de contato.", icon: Workflow },
];

export function isActivePath(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function getPageTitle(pathname: string): string {
  return NAV_ITEMS.find((i) => isActivePath(pathname, i.href))?.label ?? "LeadForge";
}
