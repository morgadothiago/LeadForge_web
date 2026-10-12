"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { PasswordStrength } from "@/components/auth/PasswordStrength";
import { resetPassword } from "@/lib/actions/auth";
import type { z } from "zod";
import { resetPasswordSchema } from "@/lib/schemas/auth";
import { Field } from "@/components/campaigns/Field";
import { getFormError } from "@/components/campaigns/form-utils";

// Tempo pra usuário ler a mensagem de sucesso antes do redirect automático pra /login (backend não
// auto-loga após o reset — D-038-2 invalida todas as sessões antigas, então o usuário precisa logar
// de novo com a senha nova).
const REDIRECT_DELAY_MS = 2000;

/** SPEC-064 — `resetPasswordSchema` (fonte unica, servidor e cliente) ja inclui `confirmPassword` e o refine "As senhas nao coincidem.". */
type ClientResetPasswordInput = z.input<typeof resetPasswordSchema>;

/**
 * SPEC-038 — "Redefinir senha". `token` vem da query string (`?token=...`) do link enviado por e-mail.
 * `resetPassword` valida o token no servidor (existe/não expirado/não usado) e retorna erro genérico
 * (`_form`) em qualquer um desses 3 casos — o frontend não tenta distinguir, só mostra a mensagem e
 * oferece um link pra pedir um novo link em `/esqueci-senha`.
 *
 * SPEC-042 — react-hook-form + `zodResolver(resetPasswordSchema)`. Erro de servidor
 * (token inválido/expirado) continua via `ActionResult.errors` -> `setError`.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [done, setDone] = React.useState(false);
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    control,
    formState: { errors },
  } = useForm<ClientResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, password: "", confirmPassword: "" },
  });

  const pw = useWatch({ control, name: "password" });

  React.useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => router.replace("/login"), REDIRECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [done, router]);

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const res = await resetPassword({ token: values.token, password: values.password, confirmPassword: values.confirmPassword });
      if (res.ok) {
        setDone(true);
        return;
      }
      if (res.errors._form) setError("root", { type: "server", message: res.errors._form.join(" ") });
      let firstFieldKey: keyof ClientResetPasswordInput | undefined;
      for (const [key, msgs] of Object.entries(res.errors)) {
        if (key === "_form") continue;
        firstFieldKey ??= key as keyof ClientResetPasswordInput;
        setError(key as keyof ClientResetPasswordInput, { type: "server", message: msgs.join(" ") });
      }
      toast.error(getFormError(res.errors));
      if (firstFieldKey) setFocus(firstFieldKey);
    });
  });

  if (done) {
    return (
      <div role="status" aria-live="polite" className="space-y-4 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CheckCircle2 aria-hidden="true" size={24} />
        </div>
        <p className="text-sm text-foreground">Senha redefinida. Faça login com a nova senha.</p>
        <Link href="/login" className="inline-block text-sm font-medium text-primary underline-offset-2 hover:underline">
          Ir para o login agora
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {errors.root?.message && (
        <div role="alert" className="space-y-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <p>{errors.root.message}</p>
          <Link href="/esqueci-senha" className="inline-block font-medium underline-offset-2 hover:underline">
            Solicitar um novo link
          </Link>
        </div>
      )}
      <Field id="password" label="Nova senha" hint="Mínimo de 6 caracteres." error={errors.password?.message}>
        {(a) => <PasswordInput {...a} {...register("password")} autoFocus required />}
      </Field>
      <PasswordStrength password={pw ?? ""} />
      <Field id="confirmPassword" label="Confirmar nova senha" error={errors.confirmPassword?.message}>
        {(a) => <PasswordInput {...a} {...register("confirmPassword")} required />}
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
        {pending ? "Redefinindo..." : "Redefinir senha"}
      </Button>
    </form>
  );
}
