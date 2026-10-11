"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/campaigns/Field";
import { applyServerErrors } from "@/components/org/org-format";
import { removeFromSuppression } from "@/lib/actions/suppression";
import { removeFromSuppressionSchema } from "@/lib/schemas/suppression";
import type { SuppressionItem } from "@/lib/queries/suppression";
import { SUPPRESSION_KIND_LABELS, maskSuppressedValue, suppressionReasonLabel } from "./suppression-format";

export const REMOVE_REASON_MIN = 5;

/** Estado do formulário RHF (SPEC-045): `reason`/`confirm` coincidem com os paths do `removeFromSuppressionSchema`. */
interface RemoveFormState {
  reason: string;
  confirm: boolean;
}

const REMOVE_FIELDS = ["reason", "confirm"] as const;

export function SuppressionRemoveDialog({ item, open, onOpenChange }: { item: SuppressionItem; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const uid = React.useId();
  const [pending, startTransition] = React.useTransition();
  const itemId = item.id;

  // Mesmas mensagens locais de antes; passando nelas, o schema do servidor valida o payload final.
  const resolver = React.useMemo(
    () =>
      zodResolver(
        z.preprocess((v: RemoveFormState, ctx) => {
          if (v.reason.trim().length < REMOVE_REASON_MIN) ctx.addIssue({ code: "custom", path: ["reason"], message: `Descreva o motivo (mínimo ${REMOVE_REASON_MIN} caracteres).` });
          if (!v.confirm) ctx.addIssue({ code: "custom", path: ["confirm"], message: "Marque a confirmação para remover." });
          return { id: itemId, reason: v.reason, confirm: v.confirm };
        }, removeFromSuppressionSchema),
      ),
    [itemId],
  );

  const { register, handleSubmit, setError, setFocus, getValues, formState } = useForm<RemoveFormState, unknown, z.output<typeof removeFromSuppressionSchema>>({
    resolver,
    defaultValues: { reason: "", confirm: false },
  });
  const { errors } = formState;

  const onSubmit = handleSubmit(() => {
    const { reason } = getValues();
    startTransition(async () => {
      const r = await removeFromSuppression({ id: itemId, reason, confirm: true });
      if (r.ok) {
        toast.success("Contato removido da lista de supressão.");
        onOpenChange(false);
        router.refresh();
        return;
      }
      toast.error(applyServerErrors(r.errors, setError, setFocus, REMOVE_FIELDS));
    });
  });

  const confirmErr = errors.confirm?.message;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Remover da lista de supressão?</DialogTitle>
          <DialogDescription>
            {SUPPRESSION_KIND_LABELS[item.kind]} {maskSuppressedValue(item.kind, item.value)} ({suppressionReasonLabel(item.reason)}).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div role="note" className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <p>
              Só remova se o contato pediu para voltar a receber. Remover pode gerar contato indevido e problema com a LGPD. Leads já encerrados não são reabertos: o contato apenas fica livre para novas campanhas.
            </p>
          </div>
          {errors.root?.message && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errors.root.message}
            </p>
          )}
          <Field id={`${uid}-reason`} label="Motivo da remoção" required error={errors.reason?.message} hint="Fica registrado para auditoria (mín. 5 caracteres).">
            {(a) => (
              <textarea
                {...a}
                rows={3}
                maxLength={300}
                {...register("reason")}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20 aria-invalid:border-destructive"
              />
            )}
          </Field>
          <div className="space-y-1">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                {...register("confirm")}
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
