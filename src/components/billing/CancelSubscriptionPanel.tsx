"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate } from "@/components/leads/lead-format";
import { applyServerErrors } from "@/components/org/org-format";
import { cancelSubscription, reactivateSubscription } from "@/lib/actions/billing";
import { cancelModeFor } from "@/lib/billing/cancel-mode";
import { cancelConfirmSchema, type CancelConfirmInput } from "@/lib/schemas/billing";
import type { SubscriptionView } from "@/lib/queries/billing";
import { RETENTION_DAYS, cancelUiState, purgeDateFor } from "./billing-format";

/**
 * SPEC-053b — cancelar / manter (reativar) a assinatura em Configurações > Assinatura. Só o owner vê os botões
 * (gating igual ao resto da página). Estados: normal (botão Cancelar + modal), cancelamento agendado (aviso + "Manter
 * assinatura") e cancelada (aviso + "Reassinar", que leva à seleção de plano = nova contratação, D-053-4).
 */
export function CancelSubscriptionPanel({ subscription, isOwner, now }: { subscription: SubscriptionView; isOwner: boolean; now?: Date }) {
  const state = cancelUiState(subscription, now);
  const purge = purgeDateFor(subscription, state);

  if (state === "canceled") {
    return (
      <div role="status" className="space-y-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
        <p className="flex items-start gap-2 font-medium text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> Assinatura cancelada
        </p>
        <p className="text-muted-foreground">
          O acesso foi encerrado. Seus dados ficam guardados por {RETENTION_DAYS} dias{purge ? <> (até <strong className="text-foreground">{formatDate(purge)}</strong>)</> : null}; depois disso são apagados em definitivo. Reassine para recuperar o acesso.
        </p>
        {isOwner && (
          <a href="#planos" className={buttonVariants({ size: "sm" })}>
            Reassinar
          </a>
        )}
      </div>
    );
  }

  if (state === "scheduled") return <ScheduledNotice subscription={subscription} isOwner={isOwner} purge={purge} />;

  if (!isOwner) return null;
  return <CancelDialogTrigger subscription={subscription} purge={purge} now={now} />;
}

function ScheduledNotice({ subscription, isOwner, purge }: { subscription: SubscriptionView; isOwner: boolean; purge: Date | null }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const end = subscription.currentPeriodEnd;

  function keep() {
    setError(null);
    startTransition(async () => {
      const r = await reactivateSubscription();
      if (r.ok) {
        toast.success(r.data.outcome === "reactivated" ? "Assinatura mantida. O cancelamento foi desfeito." : "Não havia cancelamento agendado. Sua assinatura continua ativa.");
        router.refresh();
        return;
      }
      setError(Object.values(r.errors).flat()[0] ?? "Não foi possível manter a assinatura.");
    });
  }

  return (
    <div role="status" className="space-y-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
      <p className="font-medium">Cancelamento agendado</p>
      <p className="text-muted-foreground">
        Você mantém o acesso completo até <strong className="text-foreground">{end ? formatDate(end) : "o fim do período"}</strong>. Depois disso a conta é suspensa e os dados ficam guardados por {RETENTION_DAYS} dias{purge ? <> (até {formatDate(purge)})</> : null}.
      </p>
      {isOwner && (
        <Button size="sm" onClick={keep} disabled={pending} aria-busy={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Manter assinatura
        </Button>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function CancelDialogTrigger({ subscription, purge, now }: { subscription: SubscriptionView; purge: Date | null; now?: Date }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  return (
    <>
      <Button variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setOpen(true)}>
        Cancelar assinatura
      </Button>
      <Dialog open={open} onOpenChange={(o) => (o || !busy) && setOpen(o)}>
        <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cancelar assinatura?</DialogTitle>
            <DialogDescription>Revise o que acontece antes de confirmar.</DialogDescription>
          </DialogHeader>
          <CancelForm subscription={subscription} purge={purge} now={now} onBusyChange={setBusy} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

const FIELDS = ["confirm"] as const;

/** Consequências exibidas no modal: trial = efeito imediato (D-053-3); pago = acesso até o fim do período (D-053-1); sempre sem reembolso (D-053-2). */
export function cancelConsequences(subscription: SubscriptionView, purge: Date | null, now: Date = new Date()): string[] {
  const immediate = cancelModeFor(subscription, now) === "immediate";
  const retention = `Seus dados ficam guardados por ${RETENTION_DAYS} dias${purge ? ` (até ${formatDate(purge)})` : ""} e depois são apagados em definitivo. Você pode reassinar nesse período.`;
  return [
    immediate
      ? "Como você está no período de teste, o cancelamento vale imediatamente: o acesso é suspenso agora."
      : `Você mantém o acesso completo até ${formatDate(subscription.currentPeriodEnd as Date)}. Depois disso a conta é suspensa.`,
    retention,
    "Não há reembolso proporcional do período já pago.",
  ];
}

function CancelForm({ subscription, purge, now, onBusyChange, onDone }: { subscription: SubscriptionView; purge: Date | null; now?: Date; onBusyChange: (busy: boolean) => void; onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors },
  } = useForm<CancelConfirmInput>({ resolver: zodResolver(cancelConfirmSchema), defaultValues: { confirm: false } });

  React.useEffect(() => {
    onBusyChange(pending);
    return () => onBusyChange(false);
  }, [pending, onBusyChange]);

  const consequences = cancelConsequences(subscription, purge, now);
  const immediate = cancelModeFor(subscription, now ?? new Date()) === "immediate";

  const onSubmit = handleSubmit(() => {
    startTransition(async () => {
      const res = await cancelSubscription();
      if (res.ok) {
        toast.success(res.data.outcome === "immediate" ? "Assinatura cancelada." : "Cancelamento agendado. Você mantém o acesso até o fim do período.");
        onDone();
        router.refresh();
        return;
      }
      toast.error(applyServerErrors(res.errors, setError, setFocus, FIELDS));
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      {errors.root?.message && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errors.root.message}
        </p>
      )}
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
        {consequences.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="space-y-1.5">
        <label htmlFor="cancel-confirm" className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            id="cancel-confirm"
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-primary"
            aria-invalid={Boolean(errors.confirm)}
            aria-describedby={errors.confirm ? "cancel-confirm-error" : undefined}
            {...register("confirm")}
          />
          <span>{immediate ? "Entendo que o acesso será suspenso agora." : "Entendo as consequências e quero cancelar."}</span>
        </label>
        {errors.confirm?.message && (
          <p id="cancel-confirm-error" role="alert" className="text-xs text-destructive">
            {errors.confirm.message}
          </p>
        )}
      </div>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>Voltar</DialogClose>
        <Button type="submit" variant="destructive" disabled={pending} aria-busy={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Cancelando..." : "Cancelar assinatura"}
        </Button>
      </DialogFooter>
    </form>
  );
}
