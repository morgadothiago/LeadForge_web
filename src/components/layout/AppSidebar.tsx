"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { ChevronsUpDown, LogOut } from "lucide-react";
import { toast } from "sonner";
import { getFormError } from "@/components/campaigns/form-utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { logout } from "@/lib/actions/auth";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { useNotifications } from "@/components/notifications/NotificationsProvider";
import { countFor, navNewText, navTooltip } from "@/lib/notifications/client-types";
import { Logo } from "./Logo";
import { NAV_ITEMS, isActivePath } from "./nav-items";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const chars = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "?").slice(0, 2);
  return chars.toUpperCase();
}

function NavUser({ user }: { user: { name: string; email: string } }) {
  const { isMobile } = useSidebar();
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const onLogout = () =>
    startTransition(async () => {
      const res = await logout();
      if (res.ok) router.replace(res.data.redirectTo);
      else toast.error(getFormError(res.errors, "Não foi possível sair. Tente novamente."));
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

export function AppSidebar({ user }: { user: { name: string; email: string } }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const { summary } = useNotifications();
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
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="p-3">
          <nav aria-label="Navegação principal">
            <SidebarMenu className="gap-1">
              {NAV_ITEMS.map(({ href, label, icon: Icon, badgeKey }) => {
                const active = isActivePath(pathname, href);
                const fresh = badgeKey ? countFor(summary, badgeKey) : 0;
                return (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={navTooltip(label, fresh)}
                      data-has-new={fresh > 0 ? "true" : undefined}
                      render={<Link href={href} aria-current={active ? "page" : undefined} onClick={() => setOpenMobile(false)} />}
                      className="relative h-10 gap-3 px-3 font-medium text-sidebar-foreground focus-visible:ring-primary/40 data-active:bg-primary/10 data-active:text-[#e9ecec] group-data-[collapsible=icon]:[&_svg]:size-4 [&_svg]:size-5"
                    >
                      <Icon aria-hidden="true" />
                      <span className="truncate">{label}</span>
                      {fresh > 0 ? (
                        <>
                          <span className="sr-only">{navNewText(fresh)}</span>
                          <span
                            aria-hidden="true"
                            data-slot="new-dot"
                            className="ml-auto size-2 shrink-0 rounded-full bg-[#1fb390] group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:right-1.5 group-data-[collapsible=icon]:top-1.5 group-data-[collapsible=icon]:ml-0"
                          />
                        </>
                      ) : null}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </nav>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-3 group-data-[collapsible=icon]:p-2">
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail aria-label="Recolher ou expandir menu" title="Recolher ou expandir menu" />
    </Sidebar>
  );
}
