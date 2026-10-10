"use client";
import Link from "next/link";
import * as React from "react";
import { Building2, Check, ChevronsUpDown, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { getFormError } from "@/components/campaigns/form-utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { switchActiveOrganization, type MyOrganization } from "@/lib/actions/org";
import { orgStatusLabel, roleLabel } from "./org-format";

/**
 * SPEC-049b — seletor de organização ativa na sidebar. Só renderiza com mais de uma organização (D-049-4: o
 * usuário de org única nem percebe a feature). A troca chama `switchActiveOrganization` (reemite o JWT) e faz
 * navegação COMPLETA ao destino: recarrega layout, contadores de notificação e todo o cache de cliente, para que
 * nenhum dado da org anterior fique em tela (isolamento visível, não só no servidor).
 */
export function OrgSwitcher({ organizations }: { organizations: MyOrganization[] }) {
  const { isMobile } = useSidebar();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const active = organizations.find((o) => o.isActive) ?? organizations[0];
  if (organizations.length < 2 || !active) return null;

  const onSwitch = async (o: MyOrganization) => {
    if (o.isActive || pendingId) return;
    setPendingId(o.orgId);
    const res = await switchActiveOrganization({ orgId: o.orgId });
    if (res.ok) {
      window.location.assign(res.data.redirectTo);
      return;
    }
    setPendingId(null);
    toast.error(getFormError(res.errors, "Não foi possível trocar de organização."));
  };

  return (
    <SidebarMenu className="px-3 pb-3">
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton size="lg" aria-label={`Organização ativa: ${active.name}. Trocar de organização`} tooltip={active.name} className="border border-sidebar-border data-popup-open:bg-sidebar-accent focus-visible:ring-primary/40" />}
          >
            <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Building2 className="size-4" />
            </span>
            <span className="grid min-w-0 flex-1 text-left leading-tight">
              <span className="truncate text-sm font-medium text-foreground">{active.name}</span>
              <span className="truncate text-xs text-muted-foreground">{roleLabel(active.orgRole)}</span>
            </span>
            <ChevronsUpDown aria-hidden="true" className="ml-auto size-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? "bottom" : "right"} align="start" sideOffset={8} className="min-w-64">
            <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Suas organizações</p>
            {organizations.map((o) => (
              <DropdownMenuItem key={o.orgId} onClick={() => onSwitch(o)} disabled={Boolean(pendingId) && pendingId !== o.orgId} aria-current={o.isActive ? "true" : undefined}>
                <span className="grid min-w-0 flex-1 leading-tight">
                  <span className="truncate text-sm">{o.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {roleLabel(o.orgRole)}
                    {o.status !== "active" ? ` · ${orgStatusLabel(o.status)}` : ""}
                  </span>
                </span>
                {pendingId === o.orgId ? <span className="text-xs text-muted-foreground">Trocando...</span> : o.isActive ? <Check aria-label="Organização ativa" className="size-4 text-primary" /> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/organizacoes" />}>
              <Settings2 aria-hidden="true" className="size-4" />
              Gerenciar organizações
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
