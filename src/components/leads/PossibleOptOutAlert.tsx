"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/campaigns/ConfirmDialog";
import { getFormError } from "@/components/campaigns/form-utils";
import { confirmOptOut, dismissPossibleOptOut } from "@/lib/actions/whatsapp";
import { cn } from "@/lib/utils";

export function PossibleOptOutAlert({ leadId, leadName, className }: { leadId: string; leadName: string; className?: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [confirm, setConfirm] = React.useState(false);
  const [error, setError] = React.useState<string>();

  function run(fn: () => ReturnType<typeof confirmOptOut>, ok: string, done?: () => void) {
    setError(undefined);
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(ok);
        done?.();
        router.refresh();
      } else {
        const msg = getFormError(r.errors);
        setError(msg);
        toast.error(msg);
      }
    });
  }

  return (
    <div role="status" className={cn("w-full space-y-2 rounded-md border border-warning/50 bg-warning/10 p-2.5 text-xs", className)}>
      <p className="flex items-start gap-1.5 font-medium">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <span>Possível opt-out: revise antes de contatar</span>
      </p>
      {error && !confirm && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="destructive" size="sm" disabled={pending} onClick={() => { setError(undefined); setConfirm(true); }} aria-label={`Confirmar opt-out de ${leadName}`}>
          Confirmar opt-out
        </Button>
        <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => dismissPossibleOptOut(leadId), "Alerta descartado.")} aria-label={`Descartar alerta de ${leadName}`}>
          Descartar alerta
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Confirmar opt-out?"
        description={`${leadName} não será mais contatado: a sequência é encerrada e o lead vai para Perdido.`}
        confirmLabel="Confirmar opt-out"
        destructive
        pending={pending}
        error={error}
        onConfirm={() => run(() => confirmOptOut(leadId), "Opt-out confirmado.", () => setConfirm(false))}
      />
    </div>
  );
}
