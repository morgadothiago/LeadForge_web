"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/campaigns/ConfirmDialog";
import { getFormError } from "@/components/campaigns/form-utils";
import { cancelPendingSubscription } from "@/lib/actions/billing";
import { formatDate } from "@/components/leads/lead-format";

/**
 * SPEC-062b (D-062-20) — "Cancelar assinatura" de quem ainda NÃO criou a organização (casca de cobrança). Mesmas regras da 053
 * (sem reembolso proporcional; cancelamento agendado mantém o direito até o fim do período). Imediato => volta a `/assinar`.
 */
export function CancelPendingSubscription() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string>();
  const [scheduledUntil, setScheduledUntil] = React.useState<string | null | undefined>(undefined);

  function confirm() {
    setError(undefined);
    startTransition(async () => {
      const r = await cancelPendingSubscription();
      if (!r.ok) {
        setError(getFormError(r.errors, "Não foi possível cancelar a assinatura."));
        return;
      }
      setOpen(false);
      if (r.data.outcome === "scheduled") {
        setScheduledUntil(r.data.currentPeriodEnd ? formatDate(new Date(r.data.currentPeriodEnd)) : null);
        toast.success("Cancelamento agendado.");
        router.refresh();
        return;
      }
      toast.success("Assinatura cancelada.");
      router.replace("/assinar");
      router.refresh();
    });
  }

  if (scheduledUntil !== undefined) {
    return (
      <p role="status" className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        Cancelamento agendado. O plano continua valendo {scheduledUntil ? <>até <strong className="text-foreground">{scheduledUntil}</strong></> : "até o fim do período pago"}; depois disso ele não é renovado.
      </p>
    );
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setOpen(true)}>
        Cancelar assinatura
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => {
          if (pending) return;
          setOpen(o);
          if (!o) setError(undefined);
        }}
        title="Cancelar assinatura?"
        description="Não há reembolso proporcional do período já pago. Se o plano ainda estiver dentro do período, você mantém o direito de uso até o fim dele."
        confirmLabel="Cancelar assinatura"
        destructive
        pending={pending}
        error={error}
        onConfirm={confirm}
      />
    </>
  );
}
