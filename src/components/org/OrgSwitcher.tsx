"use client";
import Link from "next/link";
import * as React from "react";
import { Check, ChevronsUpDown, Plus, Search, Settings2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { getFormError } from "@/components/campaigns/form-utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { switchActiveOrganization, type MyOrganization } from "@/lib/actions/org";
import { InviteMemberDialog } from "./InviteMemberDialog";
import { filterOrganizations, orgInitials, orgStatusLabel, roleLabel } from "./org-format";

/**
 * SPEC-049b — seletor de organização ativa na sidebar (estilo Cloudflare, D-049-16): trigger com avatar + nome,
 * busca por nome, lista com check na ativa, "Criar organização" no rodapé (link para `/assinar?nova=1`, SPEC-062). Renderiza também com 1 org (para o
 * usuário achar o "Criar organização"; supersede a parte "só com >1" do D-049-4). A troca chama
 * `switchActiveOrganization` (reemite o JWT) e faz navegação COMPLETA ao destino: recarrega layout, contadores e
 * todo o cache de cliente, para que nenhum dado da org anterior fique em tela.
 */
export function OrgSwitcher({ organizations }: { organizations: MyOrganization[] }) {
  const { isMobile } = useSidebar();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const searchRef = React.useRef<HTMLInputElement>(null);
  const active = organizations.find((o) => o.isActive) ?? organizations[0];

  React.useEffect(() => {
    if (!menuOpen) return;
    const t = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [menuOpen]);

  if (!active) return null;
  const visible = filterOrganizations(organizations, query);

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
        <DropdownMenu open={menuOpen} onOpenChange={(o) => { if (o) setQuery(""); setMenuOpen(o); }}>
          <DropdownMenuTrigger
            render={<SidebarMenuButton size="lg" aria-label={`Organização ativa: ${active.name}. Trocar de organização`} tooltip={active.name} className="border border-sidebar-border data-popup-open:bg-sidebar-accent focus-visible:ring-primary/40" />}
          >
            <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-xs font-semibold text-primary">
              {orgInitials(active.name)}
            </span>
            <span className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground">{active.name}</span>
            <ChevronsUpDown aria-hidden="true" className="ml-auto size-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? "bottom" : "right"} align="start" sideOffset={8} className="min-w-64">
            <div className="flex items-center gap-2 border-b border-border px-2 pb-2 pt-1">
              <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <input
                ref={searchRef}
                type="text"
                role="searchbox"
                aria-label="Buscar organizações"
                placeholder="Buscar organizações..."
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                // Digitar na busca não pode disparar typeahead/atalhos do menu; só Esc e setas seguem para o menu.
                onKeyDown={(e) => {
                  if (e.key !== "Escape" && e.key !== "ArrowDown" && e.key !== "ArrowUp") e.stopPropagation();
                }}
                className="h-8 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div role="group" aria-label="Suas organizações" className="max-h-64 overflow-y-auto py-1">
              {visible.length === 0 ? (
                <p role="status" className="px-2 py-3 text-center text-sm text-muted-foreground">
                  Nenhuma organização encontrada
                </p>
              ) : (
                visible.map((o) => (
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
                ))
              )}
            </div>
            <DropdownMenuSeparator />
            {active.orgRole === "owner" && (
              <DropdownMenuItem onClick={() => setInviteOpen(true)}>
                <UserPlus aria-hidden="true" className="size-4" />
                Convidar pessoas
              </DropdownMenuItem>
            )}
            {/* SPEC-062 (D-062-14): outra organização = outro plano; o fluxo é escolher plano, pagar e só então nomear. */}
            <DropdownMenuItem render={<Link href="/assinar?nova=1" />}>
              <Plus aria-hidden="true" className="size-4" />
              Criar organização
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href="/organizacoes" />}>
              <Settings2 aria-hidden="true" className="size-4" />
              Gerenciar organizações
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {active.orgRole === "owner" && <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} />}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
