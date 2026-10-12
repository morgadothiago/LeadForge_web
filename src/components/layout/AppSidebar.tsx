"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { ChevronRight, ChevronsUpDown, LogOut, Building2 } from "lucide-react";
import { toast } from "sonner";
import { getFormError } from "@/components/campaigns/form-utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { logout } from "@/lib/actions/auth";
import { clearClientStorage } from "@/lib/auth/client-logout";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { useNotifications } from "@/components/notifications/NotificationsProvider";
import { countFor, navNewText, navTooltip } from "@/lib/notifications/client-types";
import { OrgSwitcher } from "@/components/org/OrgSwitcher";
import type { MyOrganization } from "@/lib/actions/org";
import { Logo } from "./Logo";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ADMIN_NAV_ITEMS, NAV_SECTIONS, RESTRICTED_NAV_SECTIONS, aggregateFresh, hasActiveChild, isActivePath, type NavItem, type NavSection } from "./nav-items";

const ITEM_CLASS =
  "relative h-10 gap-3 px-3 font-medium text-sidebar-foreground focus-visible:ring-primary/40 data-active:bg-primary/10 data-active:text-sidebar-accent-foreground group-data-[collapsible=icon]:[&_svg]:size-4 [&_svg]:size-5";

function NewDot({ fresh }: { fresh: number }) {
  if (fresh <= 0) return null;
  return (
    <>
      <span className="sr-only">{navNewText(fresh)}</span>
      <span
        aria-hidden="true"
        data-slot="new-dot"
        className="ml-auto size-2 shrink-0 rounded-full bg-primary group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:right-1.5 group-data-[collapsible=icon]:top-1.5 group-data-[collapsible=icon]:ml-0"
      />
    </>
  );
}

function NewTag({ item }: { item: NavItem }) {
  if (item.tag !== "new") return null;
  return (
    <span data-slot="new-tag" className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none text-primary group-data-[collapsible=icon]:hidden">
      New
    </span>
  );
}

function NavEntry({ item, pathname, summary, onNavigate }: { item: NavItem; pathname: string; summary: Parameters<typeof countFor>[0]; onNavigate: () => void }) {
  const { href, label, icon: Icon, badgeKey } = item;
  const countOf = (k: NonNullable<NavItem["badgeKey"]>) => countFor(summary, k);
  if (item.children?.length) {
    const open = hasActiveChild(pathname, item);
    const fresh = aggregateFresh(item, countOf);
    return (
      <Collapsible defaultOpen={open} render={<SidebarMenuItem />}>
        <CollapsibleTrigger
          render={<SidebarMenuButton tooltip={navTooltip(label, fresh)} data-has-new={fresh > 0 ? "true" : undefined} className={`${ITEM_CLASS} group/trigger`} />}
        >
          <Icon aria-hidden="true" />
          <span className="truncate">{label}</span>
          <NewTag item={item} />
          <NewDot fresh={fresh} />
          <ChevronRight aria-hidden="true" className="ml-auto size-4 shrink-0 transition-transform group-data-[panel-open]/trigger:rotate-90 group-data-[collapsible=icon]:hidden" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {item.children.map((c) => {
              const active = isActivePath(pathname, c.href);
              return (
                <SidebarMenuSubItem key={c.href}>
                  <SidebarMenuSubButton isActive={active} render={<Link href={c.href} aria-current={active ? "page" : undefined} onClick={onNavigate} />}>
                    <span>{c.label}</span>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    );
  }
  const active = isActivePath(pathname, href);
  const fresh = badgeKey ? countFor(summary, badgeKey) : 0;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        tooltip={navTooltip(label, fresh)}
        data-has-new={fresh > 0 ? "true" : undefined}
        render={<Link href={href} aria-current={active ? "page" : undefined} onClick={onNavigate} />}
        className={ITEM_CLASS}
      >
        <Icon aria-hidden="true" />
        <span className="truncate">{label}</span>
        <NewTag item={item} />
        <NewDot fresh={fresh} />
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function NavSectionGroup({ section, pathname, summary, onNavigate }: { section: NavSection; pathname: string; summary: Parameters<typeof countFor>[0]; onNavigate: () => void }) {
  const titleId = `nav-section-${section.key}`;
  return (
    <SidebarGroup className="px-3 py-1.5">
      {section.title ? (
        <SidebarGroupLabel id={titleId} className="h-7 px-3 text-xs font-medium text-muted-foreground group-data-[collapsible=icon]:hidden">
          {section.title}
        </SidebarGroupLabel>
      ) : null}
      <nav {...(section.title ? { "aria-labelledby": titleId } : { "aria-label": "Navegação principal" })}>
        <SidebarMenu className="gap-1">
          {section.items.map((item) => (
            <NavEntry key={item.href} item={item} pathname={pathname} summary={summary} onNavigate={onNavigate} />
          ))}
        </SidebarMenu>
      </nav>
    </SidebarGroup>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const chars = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "?").slice(0, 2);
  return chars.toUpperCase();
}

function NavUser({ user, showOrgs }: { user: { name: string; email: string }; showOrgs: boolean }) {
  const { isMobile } = useSidebar();
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const onLogout = () =>
    startTransition(async () => {
      const res = await logout();
      if (res.ok) {
        clearClientStorage();
        router.replace(res.data.redirectTo);
      } else toast.error(getFormError(res.errors, "Não foi possível sair. Tente novamente."));
    });
  const avatar = (
    <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-xs font-semibold text-primary">
      {initials(user.name)}
    </span>
  );
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton size="lg" aria-label={`Menu do usuário ${user.name}`} className="data-popup-open:bg-sidebar-accent focus-visible:ring-primary/40" />}
          >
            {avatar}
            <span className="grid min-w-0 flex-1 text-left leading-tight">
              <span className="truncate text-sm font-medium text-foreground">{user.name}</span>
              <span className="truncate text-xs text-muted-foreground">{user.email}</span>
            </span>
            <ChevronsUpDown aria-hidden="true" className="ml-auto size-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? "bottom" : "right"} align="end" sideOffset={8} className="min-w-56">
            <div className="flex items-center gap-2 px-2 py-1.5">
              {avatar}
              <div className="grid min-w-0 leading-tight">
                <span className="truncate text-sm font-medium">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              </div>
            </div>
            <DropdownMenuSeparator />
            {showOrgs && (
              <DropdownMenuItem render={<Link href="/organizacoes" />}>
                <Building2 aria-hidden="true" className="size-4" />
                Minhas organizações
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onLogout} disabled={pending} aria-busy={pending}>
              <LogOut aria-hidden="true" className="size-4" />
              {pending ? "Saindo..." : "Sair"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function AppSidebar({
  user,
  platformRole = "provider",
  organizations = [],
  restricted = false,
}: {
  user: { name: string; email: string };
  platformRole?: "provider" | "platform_admin";
  /** SPEC-049b: orgs do usuário (só provider). O seletor aparece com >=1 (D-049-16); vazio = sem seletor. */
  organizations?: MyOrganization[];
  /** SPEC-065b (D-065-13.4): trial expirado => shell reduzido (so Assinatura e Minha conta; o seletor de organizacoes continua). */
  restricted?: boolean;
}) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const { summary } = useNotifications();
  // SPEC-032: platform_admin nunca vê os itens de provider (Dashboard/Leads/Campanhas... dependem de orgId, que platform_admin não tem).
  const sections: readonly NavSection[] =
    platformRole === "platform_admin" ? [{ key: "admin", items: ADMIN_NAV_ITEMS }] : restricted ? RESTRICTED_NAV_SECTIONS : NAV_SECTIONS;
  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader className="gap-0 p-0">
        <div className="group-data-[collapsible=icon]:hidden">
          <Logo />
        </div>
        <Link
          href="/dashboard"
          aria-label="LeadForge"
          className="hidden h-16 items-center justify-center font-heading text-xl font-bold text-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/40 group-data-[collapsible=icon]:flex"
        >
          L
        </Link>
        {platformRole === "provider" && <OrgSwitcher organizations={organizations} restricted={restricted} />}
      </SidebarHeader>
      <SidebarContent>
        {sections.map((section) => (
          <NavSectionGroup key={section.key} section={section} pathname={pathname} summary={summary} onNavigate={() => setOpenMobile(false)} />
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-3 group-data-[collapsible=icon]:p-2">
        <NavUser user={user} showOrgs={platformRole === "provider"} />
      </SidebarFooter>
      <SidebarRail aria-label="Recolher ou expandir menu" title="Recolher ou expandir menu" />
    </Sidebar>
  );
}
