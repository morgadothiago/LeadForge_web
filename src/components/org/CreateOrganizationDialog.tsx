"use client";
import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { OptionSelect } from "@/components/campaigns/OptionSelect";
import { createOrganization } from "@/lib/actions/org";
import { createOrganizationSchema, type CreateOrganizationInput } from "@/lib/schemas/org";
import { formatBRLCents } from "@/components/billing/billing-format";
import { applyServerErrors } from "./org-format";

export interface PlanOption {
  key: string;
  name: string;
  priceMonthlyCents: number;
}

const FIELDS = ["name", "planKey"] as const;

/** SPEC-049b — criar nova organização (D-049-3: trial próprio, plano self-service). Vira a org ativa; recarrega por completo. */
export function CreateOrganizationDialog({ plans, open: controlledOpen, onOpenChange }: { plans: PlanOption[]; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [innerOpen, setInnerOpen] = React.useState(false);
  // D-049-16: modo controlado (sem botão próprio) usado pelo seletor da sidebar; sem `open`, comporta-se como antes.
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : innerOpen;
  const setOpen = controlled ? (onOpenChange ?? (() => {})) : setInnerOpen;
  return (
    <>
      {!controlled && (
        <Button onClick={() => setOpen(true)}>
          <Plus aria-hidden="true" /> Nova organização
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova organização</DialogTitle>
            <DialogDescription>Você será o proprietário e começa com 14 dias grátis, sem cartão. A assinatura é independente das suas outras organizações.</DialogDescription>
          </DialogHeader>
          <CreateForm plans={plans} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function CreateForm({ plans }: { plans: PlanOption[] }) {
  const [pending, startTransition] = React.useTransition();
  const {
    register,
    control,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors },
  } = useForm<CreateOrganizationInput>({ resolver: zodResolver(createOrganizationSchema), defaultValues: { name: "", planKey: plans[0]?.key ?? "" } });

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const res = await createOrganization(values);
      if (res.ok) {
        toast.success("Organização criada.");
        window.location.assign(res.data.redirectTo);
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
      <Field id="org-name" label="Nome da organização" required error={errors.name?.message}>
        {(a) => <Input {...a} {...register("name")} maxLength={120} autoComplete="organization" autoFocus placeholder="Ex.: Minha Empresa Ltda." />}
      </Field>
      <Field id="org-plan" label="Plano" required error={errors.planKey?.message}>
        {(a) => (
          <Controller
            control={control}
            name="planKey"
            render={({ field }) => (
              <OptionSelect
                id={a.id}
                value={field.value || null}
                onChange={(v) => field.onChange(v ?? "")}
                placeholder="Selecione um plano"
                invalid={a["aria-invalid"]}
                describedBy={a["aria-describedby"]}
                options={plans.map((p) => ({ value: p.key, label: `${p.name} — ${formatBRLCents(p.priceMonthlyCents)}/mês` }))}
              />
            )}
          />
        )}
      </Field>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
        <Button type="submit" disabled={pending || plans.length === 0} aria-busy={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Criando..." : "Criar organização"}
        </Button>
      </DialogFooter>
    </form>
  );
}
