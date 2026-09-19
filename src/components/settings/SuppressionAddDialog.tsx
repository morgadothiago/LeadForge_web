"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { fieldError, getFormError } from "@/components/campaigns/form-utils";
import { maskBrPhone } from "@/components/leads/lead-format";
import { addToSuppression } from "@/lib/actions/suppression";
import type { FieldErrors } from "@/lib/actions/result";
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

function AddForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const uid = React.useId();
  const [kind, setKind] = React.useState<"email" | "phone">("email");
  const [value, setValue] = React.useState("");
  const [reason, setReason] = React.useState<ManualReason>("opt_out_manual");
  const [note, setNote] = React.useState("");
  const [errors, setErrors] = React.useState<FieldErrors>();
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) {
      setErrors({ [kind]: [kind === "email" ? "Informe o e-mail." : "Informe o telefone."] });
      return;
    }
    setErrors(undefined);
    startTransition(async () => {
      const r = await addToSuppression({ [kind]: value.trim(), reason, ...(note.trim() ? { note: note.trim() } : {}) });
      if (r.ok) {
        toast.success("Contato adicionado à lista de supressão.");
        onDone();
        router.refresh();
      } else {
        setErrors(r.errors);
        toast.error(getFormError(r.errors));
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      {fieldError(errors, "_form") && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {fieldError(errors, "_form")}
        </p>
      )}
      <Field id={`${uid}-kind`} label="Tipo de contato" required>
        {(a) => (
          <select
            id={a.id}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value === "phone" ? "phone" : "email");
              setValue("");
              setErrors(undefined);
            }}
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
        error={fieldError(errors, kind) ?? fieldError(errors, "leadId")}
        hint={kind === "phone" ? "DDD + 9 + 8 dígitos, ex.: (11) 91234-5678" : undefined}
      >
        {(a) =>
          kind === "email" ? (
            <Input {...a} type="email" inputMode="email" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder="nome@empresa.com" />
          ) : (
            <Input {...a} type="tel" inputMode="tel" autoComplete="off" value={value} onChange={(e) => setValue(maskBrPhone(e.target.value))} placeholder="(11) 91234-5678" />
          )
        }
      </Field>
      <Field id={`${uid}-reason`} label="Motivo" required error={fieldError(errors, "reason")}>
        {(a) => (
          <select id={a.id} value={reason} onChange={(e) => setReason(e.target.value as ManualReason)} className={selectCls}>
            {MANUAL_REASONS.map((r) => (
              <option key={r} value={r}>
                {SUPPRESSION_REASON_LABELS[r]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field id={`${uid}-note`} label="Observação" error={fieldError(errors, "note")} hint="Opcional, até 300 caracteres.">
        {(a) => <Input {...a} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />}
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
