"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { applyServerErrors } from "@/components/org/org-format";
import { maskBrPhone } from "@/components/leads/lead-format";
import { addToSuppression } from "@/lib/actions/suppression";
import { addToSuppressionSchema } from "@/lib/schemas/suppression";
import { MANUAL_REASONS, SUPPRESSION_REASON_LABELS, type ManualReason } from "./suppression-format";

const selectCls =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20";

export function SuppressionAddDialog() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus /> Adicionar à supressão
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Adicionar à lista de supressão</DialogTitle>
            <DialogDescription>O contato deixa de receber mensagens em todos os canais e campanhas.</DialogDescription>
          </DialogHeader>
          <AddForm onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Estado do formulário RHF (SPEC-045): `email`/`phone` coincidem com os paths do `addToSuppressionSchema`. */
interface SuppressionFormState {
  kind: "email" | "phone";
  email: string;
  phone: string;
  reason: ManualReason;
  note: string;
}

const SUPPRESSION_FIELDS = ["email", "phone", "reason", "note"] as const;

/** Mesmo payload de antes: só o contato do tipo escolhido (trim), motivo e observação (se houver). */
function toPayload(v: SuppressionFormState) {
  const value = (v.kind === "email" ? v.email : v.phone).trim();
  return { [v.kind]: value, reason: v.reason, ...(v.note.trim() ? { note: v.note.trim() } : {}) };
}

const resolver = zodResolver(
  z.preprocess((v: SuppressionFormState, ctx) => {
    if (!(v.kind === "email" ? v.email : v.phone).trim()) {
      ctx.addIssue({ code: "custom", path: [v.kind], message: v.kind === "email" ? "Informe o e-mail." : "Informe o telefone." });
    }
    return toPayload(v);
  }, addToSuppressionSchema),
);

function AddForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const uid = React.useId();
  const [pending, startTransition] = React.useTransition();
  const { register, handleSubmit, watch, setValue, clearErrors, setError, setFocus, getValues, control, formState } = useForm<SuppressionFormState, unknown, z.output<typeof addToSuppressionSchema>>({
    resolver,
    defaultValues: { kind: "email", email: "", phone: "", reason: "opt_out_manual", note: "" },
  });
  const { errors } = formState;
  const kind = watch("kind");

  const onSubmit = handleSubmit(() => {
    const payload = toPayload(getValues());
    startTransition(async () => {
      const r = await addToSuppression(payload);
      if (r.ok) {
        toast.success("Contato adicionado à lista de supressão.");
        onDone();
        router.refresh();
        return;
      }
      toast.error(applyServerErrors(r.errors, setError, setFocus, SUPPRESSION_FIELDS));
    });
  });

  const valueError = (kind === "email" ? errors.email?.message : errors.phone?.message);

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      {errors.root?.message && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errors.root.message}
        </p>
      )}
      <Field id={`${uid}-kind`} label="Tipo de contato" required>
        {(a) => (
          <select
            id={a.id}
            {...register("kind", {
              onChange: () => {
                setValue("email", "");
                setValue("phone", "");
                clearErrors();
              },
            })}
            className={selectCls}
          >
            <option value="email">E-mail</option>
            <option value="phone">Telefone (celular BR)</option>
          </select>
        )}
      </Field>
      <Field
        id={`${uid}-value`}
        label={kind === "email" ? "E-mail" : "Telefone"}
        required
        error={valueError}
        hint={kind === "phone" ? "DDD + 9 + 8 dígitos, ex.: (11) 91234-5678" : undefined}
      >
        {(a) =>
          kind === "email" ? (
            <Input {...a} {...register("email")} type="email" inputMode="email" autoComplete="off" placeholder="nome@empresa.com" />
          ) : (
            <Controller
              control={control}
              name="phone"
              render={({ field }) => (
                <Input {...a} {...field} type="tel" inputMode="tel" autoComplete="off" placeholder="(11) 91234-5678" onChange={(e) => field.onChange(maskBrPhone(e.target.value))} />
              )}
            />
          )
        }
      </Field>
      <Field id={`${uid}-reason`} label="Motivo" required error={errors.reason?.message}>
        {(a) => (
          <select id={a.id} {...register("reason")} className={selectCls}>
            {MANUAL_REASONS.map((r) => (
              <option key={r} value={r}>
                {SUPPRESSION_REASON_LABELS[r]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field id={`${uid}-note`} label="Observação" error={errors.note?.message} hint="Opcional, até 300 caracteres.">
        {(a) => <Input {...a} {...register("note")} maxLength={300} />}
      </Field>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? "Adicionando…" : "Adicionar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
