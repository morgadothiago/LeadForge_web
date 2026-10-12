"use client";
import * as React from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { applyServerErrors } from "@/components/org/org-format";
import { withoutCodeKey } from "@/components/billing/plan-checkout-ui";
import { completeOrganizationSetup } from "@/lib/actions/billing";
import { completeOrgSetupSchema, type CompleteOrgSetupInput } from "@/lib/schemas/billing";

const FIELDS = ["name"] as const;

/**
 * SPEC-062b (D-062-13) — `/organizacao/nova`: nomear a organização cujo plano já está pago. react-hook-form +
 * `zodResolver(completeOrgSetupSchema)` (mesmo schema da action). Idempotente no servidor (duplo submit não cria 2ª org).
 * `no_paid_plan` => orienta a escolher plano. Sucesso => navegação COMPLETA ao `redirectTo` (a sessão foi reemitida com a nova org).
 */
export function OrganizationSetupForm() {
  const [pending, startTransition] = React.useTransition();
  const [noPaidPlan, setNoPaidPlan] = React.useState(false);
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors },
  } = useForm<CompleteOrgSetupInput>({ resolver: zodResolver(completeOrgSetupSchema), defaultValues: { name: "" } });

  const onSubmit = handleSubmit((values) => {
    setNoPaidPlan(false);
    startTransition(async () => {
      const res = await completeOrganizationSetup(values);
      if (res.ok) {
        window.location.assign(res.data.redirectTo);
        return;
      }
      if (res.errors.code?.[0] === "no_paid_plan") setNoPaidPlan(true);
      toast.error(applyServerErrors(withoutCodeKey(res.errors), setError, setFocus, FIELDS));
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {errors.root?.message && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errors.root.message}
          {noPaidPlan && (
            <>
              {" "}
              <Link href="/assinar" className="font-medium underline underline-offset-2">
                Escolher um plano
              </Link>
            </>
          )}
        </p>
      )}
      <Field id="org-name" label="Nome da organização" hint="Geralmente o nome da sua empresa. Você pode mudar depois." error={errors.name?.message}>
        {(a) => <Input {...a} {...register("name")} type="text" autoComplete="organization" autoFocus required maxLength={120} />}
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
        {pending ? "Criando organização..." : "Criar organização"}
      </Button>
    </form>
  );
}
