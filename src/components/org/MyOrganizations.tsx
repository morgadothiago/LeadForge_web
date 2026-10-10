"use client";
import Link from "next/link";
import * as React from "react";
import { Building2, Check, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/campaigns/ConfirmDialog";
import { getFormError } from "@/components/campaigns/form-utils";
import { leaveOrganization, switchActiveOrganization, type MyOrganization } from "@/lib/actions/org";
import { InviteMemberDialog } from "./InviteMemberDialog";
import { CreateOrganizationDialog, type PlanOption } from "./CreateOrganizationDialog";
import { orgStatusLabel, roleLabel } from "./org-format";

/**
 * SPEC-049b — "Minhas organizações": lista (ativa destacada), troca, criar nova e sair. `leaveOrganization` sempre
 * age na org ATIVA (contrato do backend), então "Sair" só aparece na linha ativa; as demais oferecem "Ativar".
 * Sair da única organização é bloqueado pelo servidor — a UI só orienta (botão desabilitado com explicação).
 */
export function MyOrganizations({ organizations, plans }: { organizations: MyOrganization[]; plans: PlanOption[] }) {
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = React.useState(false);
  const [leaving, setLeaving] = React.useState(false);
  const [leaveError, setLeaveError] = React.useState<string>();
  const only = organizations.length <= 1;
  const active = organizations.find((o) => o.isActive);

  async function onActivate(o: MyOrganization, goTo?: string) {
    setPendingId(o.orgId);
    const res = await switchActiveOrganization({ orgId: o.orgId });
    if (res.ok) {
      window.location.assign(goTo ?? res.data.redirectTo);
      return;
    }
    setPendingId(null);
    toast.error(getFormError(res.errors, "Não foi possível trocar de organização."));
  }

  async function onLeave() {
    setLeaving(true);
    setLeaveError(undefined);
    const res = await leaveOrganization();
    if (res.ok) {
      toast.success("Você saiu da organização.");
      window.location.assign(res.data.redirectTo);
      return;
    }
    setLeaving(false);
    setLeaveError(getFormError(res.errors, "Não foi possível sair da organização."));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-heading text-lg font-semibold">Minhas organizações</h2>
          <p className="text-sm text-muted-foreground">Organizações das quais você faz parte. Os dados de cada uma ficam totalmente separados.</p>
        </div>
        <CreateOrganizationDialog plans={plans} />
      </div>

      {organizations.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <Building2 aria-hidden="true" className="size-8 text-muted-foreground" />
          <p className="font-heading font-semibold">Você ainda não participa de nenhuma organização</p>
          <p className="text-sm text-muted-foreground">Crie uma organização para começar.</p>
        </Card>
      ) : (
        <ul className="grid gap-3" aria-label="Lista de organizações">
          {organizations.map((o) => (
            <li key={o.orgId}>
              <Card className={o.isActive ? "border-primary/50" : undefined}>
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                      <Building2 className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="break-words font-medium">{o.name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge variant="muted">{roleLabel(o.orgRole)}</Badge>
                        {o.status !== "active" && <Badge variant="destructive">{orgStatusLabel(o.status)}</Badge>}
                        {o.isActive && (
                          <Badge>
                            <Check aria-hidden="true" className="size-3" /> Ativa agora
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {o.isActive && o.orgRole === "owner" && (
                      <>
                        {/* D-049-17: convidar age na org ATIVA (contrato do backend) — só na linha ativa. */}
                        <InviteMemberDialog triggerLabel="Convidar" triggerVariant="outline" triggerSize="sm" />
                        <Link href="/configuracoes/equipe" className={buttonVariants({ variant: "outline", size: "sm" })}>
                          Equipe
                        </Link>
                      </>
                    )}
                    {!o.isActive && o.orgRole === "owner" && o.status !== "cancelled" && (
                      <Button variant="outline" size="sm" onClick={() => onActivate(o, "/configuracoes/equipe")} disabled={pendingId !== null}>
                        Gerenciar equipe
                      </Button>
                    )}
                    {o.isActive ? (
                      <Button variant="outline" size="sm" onClick={() => setLeaveOpen(true)} disabled={only} aria-describedby={only ? "leave-hint" : undefined}>
                        <LogOut aria-hidden="true" /> Sair
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => onActivate(o)} disabled={pendingId !== null || o.status === "cancelled"} aria-busy={pendingId === o.orgId}>
                        {pendingId === o.orgId ? "Trocando..." : "Usar esta organização"}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {only && organizations.length === 1 && (
        <p id="leave-hint" className="text-xs text-muted-foreground">
          Você não pode sair da sua única organização. Crie ou entre em outra antes de sair.
        </p>
      )}

      <ConfirmDialog
        open={leaveOpen}
        onOpenChange={(o) => {
          setLeaveOpen(o);
          if (!o) setLeaveError(undefined);
        }}
        title={`Sair de ${active?.name ?? "esta organização"}?`}
        description="Você perde o acesso aos dados desta organização e será levado a outra das suas organizações. Para voltar, precisará de um novo convite."
        confirmLabel="Sair da organização"
        destructive
        pending={leaving}
        error={leaveError}
        onConfirm={onLeave}
      />
    </div>
  );
}
