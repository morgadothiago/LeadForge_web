"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { getFormError } from "@/components/campaigns/form-utils";
import { formatBRLCents } from "@/components/billing/billing-format";
import { createCheckoutSession, signUpAndStartCheckout } from "@/lib/actions/billing";
import { signupSchema, type SignupInput } from "@/lib/schemas/billing";
import type { BillingCadence } from "@prisma/client";

/**
 * SPEC-034/D-35-1 — signup self-service. Campos mínimos (nome, e-mail, senha, nome da empresa),
 * mesmo padrão de `LoginForm`. `planKey`/`cadence` chegam via query param da landing (fora de escopo
 * aqui, SPEC-035) e nunca aparecem como campo do form; `intentCheckout` decide o redirecionamento pós-
 * cadastro: se veio de um CTA de plano específico, segue direto para o checkout daquele plano; senão,
 * só inicia o trial (D-33-3, 14 dias sem cartão) e vai para `/dashboard`.
 *
 * SPEC-042 — react-hook-form + `zodResolver(signupSchema)`, mesmo schema já usado por
 * `signUpAndStartCheckout` (`src/lib/schemas/billing.ts`). `planKey` entra como `defaultValues` (não é
 * campo editável pelo usuário) só para satisfazer o schema completo do servidor sem redefinir regra
 * nenhuma. Erro de servidor continua via `ActionResult.errors` -> `setError` (`errors.root` para o
 * geral, equivalente ao antigo `_form`) + `toast.error(getFormError(...))`.
 */
export function SignupForm({
  planKey,
  planName,
  planPriceCents,
  cadence,
  intentCheckout,
}: {
  planKey: string;
  planName: string;
  planPriceCents: number | null;
  cadence: BillingCadence;
  intentCheckout: boolean;
}) {
  const router = useRouter();
  const [show, setShow] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors },
  } = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: "", email: "", password: "", orgName: "", planKey },
  });

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const res = await signUpAndStartCheckout(values);
      if (!res.ok) {
        if (res.errors._form) setError("root", { type: "server", message: res.errors._form.join(" ") });
        let firstFieldKey: keyof SignupInput | undefined;
        for (const [key, msgs] of Object.entries(res.errors)) {
          if (key === "_form") continue;
          firstFieldKey ??= key as keyof SignupInput;
          setError(key as keyof SignupInput, { type: "server", message: msgs.join(" ") });
        }
        toast.error(getFormError(res.errors));
        if (firstFieldKey) setFocus(firstFieldKey);
        return;
      }

      if (!intentCheckout) {
        router.replace(res.data.redirectTo);
        return;
      }

      // Conta criada com trial ativo; agora autenticado, segue direto para o checkout do plano escolhido.
      const checkout = await createCheckoutSession({ planKey, cadence });
      if (checkout.ok) {
        window.location.href = checkout.data.url;
        return;
      }
      // Cadastro já concluiu com sucesso (sessão criada): não bloqueia o usuário por falha no checkout, ele tenta de novo em Configurações > Assinatura.
      router.replace("/dashboard");
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {errors.root?.message && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errors.root.message}
        </p>
      )}
      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Você começa no plano <strong className="text-foreground">{planName}</strong>
        {planPriceCents !== null && <> ({formatBRLCents(planPriceCents)}{cadence === "monthly" ? "/mês" : "/ano"})</>} — 14 dias grátis, sem cartão de crédito.
      </p>
      <Field id="name" label="Nome" error={errors.name?.message}>
        {(a) => <Input {...a} {...register("name")} type="text" autoComplete="name" autoFocus required />}
      </Field>
      <Field id="email" label="E-mail" error={errors.email?.message}>
        {(a) => <Input {...a} {...register("email")} type="email" inputMode="email" autoComplete="email" required />}
      </Field>
      <Field id="password" label="Senha" hint="Mínimo de 12 caracteres." error={errors.password?.message}>
        {(a) => (
          <div className="relative">
            <Input {...a} {...register("password")} type={show ? "text" : "password"} autoComplete="new-password" required className="pr-11" />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? "Ocultar senha" : "Mostrar senha"}
              aria-pressed={show}
              className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {show ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            </button>
          </div>
        )}
      </Field>
      <Field id="orgName" label="Nome da empresa" error={errors.orgName?.message}>
        {(a) => <Input {...a} {...register("orgName")} type="text" autoComplete="organization" required />}
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
        {pending ? "Criando conta..." : "Criar conta"}
      </Button>
    </form>
  );
}
