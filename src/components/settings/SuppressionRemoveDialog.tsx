"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/campaigns/Field";
import { fieldError, getFormError } from "@/components/campaigns/form-utils";
import { removeFromSuppression } from "@/lib/actions/suppression";
import type { FieldErrors } from "@/lib/actions/result";
import type { SuppressionItem } from "@/lib/queries/suppression";
import { SUPPRESSION_KIND_LABELS, maskSuppressedValue, suppressionReasonLabel } from "./suppression-format";

export const REMOVE_REASON_MIN = 5;

export function SuppressionRemoveDialog({ item, open, onOpenChange }: { item: SuppressionItem; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const uid = React.useId();
  const [reason, setReason] = React.useState("");
  const [confirm, setConfirm] = React.useState(false);
  const [errors, setErrors] = React.useState<FieldErrors>();
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const local: FieldErrors = {};
    if (reason.trim().length < REMOVE_REASON_MIN) local.reason = [`Descreva o motivo (mínimo ${REMOVE_REASON_MIN} caracteres).`];
    if (!confirm) local.confirm = ["Marque a confirmação para remover."];
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setErrors(undefined);
    startTransition(async () => {
      const r = await removeFromSuppression({ id: item.id, reason, confirm: true });
      if (r.ok) {
        toast.success("Contato removido da lista de supressão.");
        onOpenChange(false);
        router.refresh();
      } else {
        setErrors(r.errors);
        toast.error(getFormError(r.errors));
      }
    });
  }

  const formError = fieldError(errors, "_form") ?? fieldError(errors, "id");
  const confirmErr = fieldError(errors, "confirm");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Remover da lista de supressão?</DialogTitle>
          <DialogDescription>
            {SUPPRESSION_KIND_LABELS[item.kind]} {maskSuppressedValue(item.kind, item.value)} ({suppressionReasonLabel(item.reason)}).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <div role="note" className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <p>
              Só remova se o contato pediu para voltar a receber. Remover pode gerar contato indevido e problema com a LGPD. Leads já encerrados não são reabertos: o contato apenas fica livre para novas campanhas.
            </p>
          </div>
          {formError && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {formError}
            </p>
          )}
          <Field id={`${uid}-reason`} label="Motivo da remoção" required error={fieldError(errors, "reason")} hint="Fica registrado para auditoria (mín. 5 caracteres).">
            {(a) => (
              <textarea
                {...a}
                rows={3}
                maxLength={300}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20 aria-invalid:border-destructive"
              />
            )}
          </Field>
          <div className="space-y-1">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirm}
                onChange={(e) => setConfirm(e.target.checked)}
                aria-invalid={Boolean(confirmErr)}
                aria-describedby={confirmErr ? `${uid}-confirm-err` : undefined}
                className="mt-0.5 size-4 accent-[var(--primary)]"
              />
              <span>Confirmo que o contato pediu para voltar a receber mensagens.</span>
            </label>
            {confirmErr && (
              <p id={`${uid}-confirm-err`} role="alert" className="text-xs text-destructive">
                {confirmErr}
              </p>
            )}
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Removendo…" : "Remover da supressão"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
