"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resetPassword } from "@/lib/actions/auth";
import { resetPasswordSchema } from "@/lib/schemas/auth";
import { Field } from "@/components/campaigns/Field";
import { getFormError } from "@/components/campaigns/form-utils";

// Tempo pra usuário ler a mensagem de sucesso antes do redirect automático pra /login (backend não
// auto-loga após o reset — D-038-2 invalida todas as sessões antigas, então o usuário precisa logar
// de novo com a senha nova).
const REDIRECT_DELAY_MS = 2000;

/**
 * SPEC-042 — `resetPasswordSchema` (`src/lib/schemas/auth.ts`) é a fonte única pra `token`/`password`
 * (mesmas regras do servidor, via `.extend`, nunca redefinidas aqui). `confirmPassword` é um campo
 * puramente client-side (o servidor nunca o recebe/valida) — adicionado via `.extend()` + `.refine()`
 * comparando as duas senhas, sem tocar nas regras herdadas de `resetPasswordSchema`.
 */
const clientResetPasswordSchema = resetPasswordSchema
  .extend({
    confirmPassword: z.string({ error: "Confirme a nova senha." }).min(1, "Confirme a nova senha."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não coincidem.",
    path: ["confirmPassword"],
  });

type ClientResetPasswordInput = z.input<typeof clientResetPasswordSchema>;

/**
 * SPEC-038 — "Redefinir senha". `token` vem da query string (`?token=...`) do link enviado por e-mail.
 * `resetPassword` valida o token no servidor (existe/não expirado/não usado) e retorna erro genérico
 * (`_form`) em qualquer um desses 3 casos — o frontend não tenta distinguir, só mostra a mensagem e
 * oferece um link pra pedir um novo link em `/esqueci-senha`.
 *
 * SPEC-042 — react-hook-form + `zodResolver(clientResetPasswordSchema)`. Erro de servidor
 * (token inválido/expirado) continua via `ActionResult.errors` -> `setError`.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [show, setShow] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [done, setDone] = React.useState(false);
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors },
  } = useForm<ClientResetPasswordInput>({
    resolver: zodResolver(clientResetPasswordSchema),
    defaultValues: { token, password: "", confirmPassword: "" },
  });

  React.useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => router.replace("/login"), REDIRECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [done, router]);

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const res = await resetPassword({ token: values.token, password: values.password });
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
      <Field id="password" label="Nova senha" hint="Mínimo de 12 caracteres." error={errors.password?.message}>
        {(a) => (
          <div className="relative">
            <Input
              {...a}
              {...register("password")}
              type={show ? "text" : "password"}
              autoComplete="new-password"
              autoFocus
              required
              className="pr-11"
            />
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
      <Field id="confirmPassword" label="Confirmar nova senha" error={errors.confirmPassword?.message}>
        {(a) => (
          <Input
            {...a}
            {...register("confirmPassword")}
            type={show ? "text" : "password"}
            autoComplete="new-password"
            required
          />
        )}
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
        {pending ? "Redefinindo..." : "Redefinir senha"}
      </Button>
    </form>
  );
}
