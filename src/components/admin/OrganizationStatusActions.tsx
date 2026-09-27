"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { OrgStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/campaigns/ConfirmDialog";
import { getFormError } from "@/components/campaigns/form-utils";
import { reactivateOrganization, suspendOrganization } from "@/lib/actions/admin/organizations";

const REASON_MIN = 3;
const REASON_MAX = 500;

/**
 * SPEC-032 — suspender/reativar uma Organization. Motivo obrigatório ao suspender (validação client-
 * side espelha `suspendOrganizationSchema`, mas o backend sempre revalida — feedback aqui é só UX).
 * `router.refresh()` após sucesso: sem estado próprio de status, a página relê `getOrganizationDetail`.
 */
export function OrganizationStatusActions({ orgId, orgName, status }: { orgId: string; orgName: string; status: OrgStatus }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string>();
  const reasonTooShort = reason.trim().length > 0 && reason.trim().length < REASON_MIN;
  const reasonInvalid = reason.trim().length < REASON_MIN;

  const close = () => {
    setOpen(false);
    setReason("");
    setError(undefined);
  };

  const onSuspend = () => {
    if (reasonInvalid) {
      setError(`Informe um motivo com ao menos ${REASON_MIN} caracteres.`);
      return;
    }
    setError(undefined);
    startTransition(async () => {
      const r = await suspendOrganization({ orgId, reason: reason.trim() });
      if (r.ok) {
        toast.success(`${orgName} foi suspensa.`);
        close();
        router.refresh();
      } else {
        const msg = getFormError(r.errors);
        setError(msg);
        toast.error(msg);
      }
    });
  };

  const onReactivate = () => {
    startTransition(async () => {
      const r = await reactivateOrganization({ orgId });
      if (r.ok) {
        toast.success(`${orgName} foi reativada.`);
        router.refresh();
      } else {
        toast.error(getFormError(r.errors));
      }
    });
  };

  if (status === "active") {
    return (
      <>
        <Button variant="destructive" disabled={pending} onClick={() => setOpen(true)}>
          Suspender organização
        </Button>
        <ConfirmDialog
          open={open}
          onOpenChange={(o) => (o ? setOpen(true) : close())}
          title="Suspender organização?"
          description={`${orgName} para de ser processada pelo scheduler (campanhas/sequências pausam). Nenhum dado é apagado.`}
          confirmLabel="Suspender"
          destructive
          pending={pending}
          error={error}
          confirmDisabled={reasonInvalid}
          onConfirm={onSuspend}
        >
          <div className="grid gap-1.5">
            <label htmlFor="suspend-reason" className="text-sm font-medium">
              Motivo <span aria-hidden="true">*</span>
              <span className="sr-only"> (obrigatório)</span>
            </label>
            <textarea
              id="suspend-reason"
              rows={3}
              maxLength={REASON_MAX}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              aria-required="true"
              aria-invalid={reasonTooShort || undefined}
              aria-describedby="suspend-reason-count"
              placeholder="Ex.: inadimplência confirmada, abuso de uso, pedido do cliente..."
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20 aria-invalid:border-destructive"
            />
            <p id="suspend-reason-count" className="text-right text-xs text-muted-foreground" aria-live="polite">
              {reason.length}/{REASON_MAX} (mínimo {REASON_MIN})
            </p>
          </div>
        </ConfirmDialog>
      </>
    );
  }

  return (
    <Button disabled={pending} onClick={onReactivate} aria-busy={pending}>
      {pending ? "Reativando…" : "Reativar organização"}
    </Button>
  );
}
