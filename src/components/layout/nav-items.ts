import { Bell, Building2, CalendarDays, Kanban, ClipboardCheck, LayoutDashboard, Megaphone, Settings, Users, Video, Workflow, type LucideIcon } from "lucide-react";

import type { NavBadgeKey } from "@/lib/notifications/client-types";

export interface NavItem {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Chave do contador "novo" (bolinha) em `NotificationSummaryState`; ausente = sem bolinha. */
  badgeKey?: NavBadgeKey;
  /** SPEC-057: subitens expansíveis (só com rota real). */
  children?: readonly NavItem[];
  /** SPEC-057: selo "New" para funcionalidade recém-lançada. */
  tag?: "new";
}

export interface NavSection {
  key: string;
  /** Ausente = seção do topo, sem título. */
  title?: string;
  items: readonly NavItem[];
}

/** SPEC-057: navegação do tenant agrupada em seções (mesmas rotas/permissões/contadores de antes). */
export const NAV_SECTIONS: readonly NavSection[] = [
  {
    key: "topo",
    items: [{ href: "/dashboard", label: "Dashboard", description: "Visão geral das métricas de prospecção.", icon: LayoutDashboard }],
  },
  {
    key: "captacao",
    title: "Captação de leads",
    items: [
      { href: "/leads", label: "Leads", description: "Lista e detalhes dos seus leads.", icon: Users, badgeKey: "leads" },
      { href: "/pipeline", label: "Pipeline", description: "Acompanhe leads por etapa do funil.", icon: Kanban },
      { href: "/campanhas", label: "Campanhas", description: "Gerencie campanhas e ICPs.", icon: Megaphone },
      { href: "/sequences", label: "Sequences", description: "Monte cadências de contato.", icon: Workflow },
      { href: "/calendario", label: "Calendário", description: "Reuniões agendadas por dia, semana e mês.", icon: CalendarDays, badgeKey: "calendario" },
    ],
  },
  {
    key: "criativos",
    title: "Criativos",
    items: [{ href: "/criativos", label: "Criativos", description: "Vídeos de avatar com IA para suas campanhas.", icon: Video, tag: "new" }],
  },
  {
    key: "automacao",
    title: "Automação",
    items: [{ href: "/aprovacoes", label: "Aprovações", description: "Revise rascunhos dos agentes de IA.", icon: ClipboardCheck, badgeKey: "aprovacoes" }],
  },
  {
    key: "conta",
    title: "Conta",
    items: [
      { href: "/notificacoes", label: "Notificações", description: "Alertas e lembretes do sistema.", icon: Bell, badgeKey: "notificacoes" },
      { href: "/configuracoes", label: "Configurações", description: "Contas de envio e integrações.", icon: Settings, badgeKey: "configuracoes" },
    ],
  },
];

/** Achata itens (pai seguido dos filhos), preservando a ordem. */
export function flattenItems(items: readonly NavItem[]): NavItem[] {
  return items.flatMap((i) => [i, ...(i.children ? flattenItems(i.children) : [])]);
}

export function flattenSections(sections: readonly NavSection[]): NavItem[] {
  return sections.flatMap((s) => flattenItems(s.items));
}

/** Derivado de `NAV_SECTIONS` (ordem das seções) para `getPageTitle`/`isActivePath`/testes. */
export const NAV_ITEMS: readonly NavItem[] = flattenSections(NAV_SECTIONS);

/** Há filho ativo na rota atual? (item pai abre sozinho). */
export function hasActiveChild(pathname: string, item: NavItem): boolean {
  return (item.children ?? []).some((c) => isActivePath(pathname, c.href) || hasActiveChild(pathname, c));
}

/** Soma de novidades do item e de seus descendentes (bolinha agregada do pai). */
export function aggregateFresh(item: NavItem, countOf: (key: NavBadgeKey) => number): number {
  const own = item.badgeKey ? countOf(item.badgeKey) : 0;
  return own + (item.children ?? []).reduce((acc, c) => acc + aggregateFresh(c, countOf), 0);
}

/**
 * SPEC-032 — navegação do `platform_admin` (cross-tenant, sem `orgId`): substitui INTEIRAMENTE
 * `NAV_ITEMS` na sidebar (nunca aparece junto) — nenhum item de `NAV_ITEMS` faz sentido sem org
 * (Dashboard/Leads/Campanhas etc. dependem de `orgId`). `provider` nunca vê `ADMIN_NAV_ITEMS`.
 */
export const ADMIN_NAV_ITEMS: readonly NavItem[] = [
  { href: "/admin/organizacoes", label: "Administração", description: "Organizations da plataforma: listar, ver detalhe, suspender/reativar.", icon: Building2 },
];

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getPageTitle(pathname: string): string {
  // SPEC-049b: telas fora da navegação principal (acessadas pelo seletor/menu do usuário).
  if (isActivePath(pathname, "/organizacoes")) return "Organizações";
  return [...NAV_ITEMS, ...ADMIN_NAV_ITEMS].find((i) => isActivePath(pathname, i.href))?.label ?? "LeadForge";
}
