"use client";
import * as React from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { forgotPassword } from "@/lib/actions/auth";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/schemas/auth";
import { Field } from "@/components/campaigns/Field";
import { getFormError } from "@/components/campaigns/form-utils";

/**
 * SPEC-038 — "Esqueci minha senha". `forgotPassword` sempre responde com a mesma mensagem genérica
 * (anti-enumeration, decisão do backend): nunca diferencia e-mail cadastrado de não cadastrado, então
 * o frontend só precisa exibir `res.data.message` como está, sem tentar "melhorar" a informação.
 *
 * SPEC-042 — react-hook-form + `zodResolver(forgotPasswordSchema)`, mesmo schema da action
 * (`src/lib/schemas/auth.ts`). Erro de servidor via `ActionResult.errors` -> `setError`.
 */
export function ForgotPasswordForm() {
  const [pending, startTransition] = React.useTransition();
  const [sentMessage, setSentMessage] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const res = await forgotPassword(values);
      if (res.ok) {
        setSentMessage(res.data.message);
        return;
      }
      if (res.errors._form) setError("root", { type: "server", message: res.errors._form.join(" ") });
      let firstFieldKey: keyof ForgotPasswordInput | undefined;
      for (const [key, msgs] of Object.entries(res.errors)) {
        if (key === "_form") continue;
        firstFieldKey ??= key as keyof ForgotPasswordInput;
        setError(key as keyof ForgotPasswordInput, { type: "server", message: msgs.join(" ") });
      }
      toast.error(getFormError(res.errors));
      if (firstFieldKey) setFocus(firstFieldKey);
    });
  });

  if (sentMessage) {
    return (
      <div role="status" aria-live="polite" className="space-y-4 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CheckCircle2 aria-hidden="true" size={24} />
        </div>
        <p className="text-sm text-foreground">{sentMessage}</p>
        <Link href="/login" className="inline-block text-sm font-medium text-primary underline-offset-2 hover:underline">
          Voltar para o login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {errors.root?.message && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errors.root.message}
        </p>
      )}
      <Field id="email" label="E-mail" error={errors.email?.message}>
        {(a) => (
          <Input
            {...a}
            {...register("email")}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            required
          />
        )}
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
        {pending ? "Enviando..." : "Enviar link de recuperação"}
      </Button>
    </form>
  );
}
