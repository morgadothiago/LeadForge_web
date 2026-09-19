"use client";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { updateOpportunity } from "@/lib/actions/pipeline";
import type { BoardCard } from "@/lib/queries/pipeline";

export function EditOpportunityDialog({
  card,
  open,
  onOpenChange,
  onSaved,
}: {
  card: BoardCard;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (patch: { value: number | null; notes: string | null }) => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const uid = React.useId();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const rawValue = String(fd.get("value") ?? "").trim().replace(",", ".");
    const value = rawValue === "" ? null : Number(rawValue);
    if (value !== null && !Number.isFinite(value)) {
      setErrors({ value: ["Valor inválido."] });
      return;
    }
    const notes = String(fd.get("notes") ?? "").trim() || null;
    startTransition(async () => {
      const r = await updateOpportunity({ opportunityId: card.id, value, notes });
      if (r.ok) {
        setErrors({});
        onSaved({ value, notes });
        toast.success("Oportunidade atualizada.");
        onOpenChange(false);
      } else {
        setErrors(r.errors);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar oportunidade</DialogTitle>
          <DialogDescription>{card.lead.name}{card.lead.company ? ` · ${card.lead.company}` : ""}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <Field id={`${uid}-value`} label="Valor (R$)" error={errors.value?.[0]}>
            {(a) => <Input {...a} name="value" inputMode="decimal" defaultValue={card.value ?? ""} placeholder="0,00" />}
          </Field>
          <Field id={`${uid}-notes`} label="Notas" error={errors.notes?.[0]}>
            {(a) => (
              <textarea
                {...a}
                name="notes"
                rows={4}
                maxLength={5000}
                defaultValue={card.notes ?? ""}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20 aria-invalid:border-destructive"
              />
            )}
          </Field>
          {card.stage === "perdido" && card.lostReason && (
            <div className="grid gap-1">
              <span className="text-sm font-medium">Motivo da perda</span>
              <p className="whitespace-pre-wrap break-words rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{card.lostReason}</p>
            </div>
          )}
          {errors._form?.[0] && (
            <p role="alert" className="text-sm text-destructive">
              {errors._form[0]}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
