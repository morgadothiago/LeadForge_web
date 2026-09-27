"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { login } from "@/lib/actions/auth";
import { loginSchema, type LoginInput } from "@/lib/schemas/auth";
import { Field } from "@/components/campaigns/Field";
import { getFormError } from "@/components/campaigns/form-utils";

// SPEC-042 — padrão react-hook-form + zodResolver(schemaDoServidor), ver spec.md para a convenção
// completa. Validação client-side usa o MESMO `loginSchema` da action (`src/lib/schemas/auth.ts`),
// nunca uma cópia. Erro de servidor (ex.: credenciais inválidas, rate limit) não é coberto pelo Zod
// client, então continua chegando via `ActionResult.errors` e é aplicado nos campos com `setError`
// (mensagem geral em `errors.root`, equivalente ao antigo `_form`).
export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [show, setShow] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "", next },
  });

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const res = await login(values);
      if (res.ok) {
        router.replace(res.data.redirectTo);
        return;
      }
      if (res.errors._form) setError("root", { type: "server", message: res.errors._form.join(" ") });
      let firstFieldKey: keyof LoginInput | undefined;
      for (const [key, msgs] of Object.entries(res.errors)) {
        if (key === "_form") continue;
        firstFieldKey ??= key as keyof LoginInput;
        setError(key as keyof LoginInput, { type: "server", message: msgs.join(" ") });
      }
      toast.error(getFormError(res.errors));
      // Foco no primeiro campo inválido após render.
      if (firstFieldKey) setFocus(firstFieldKey);
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {errors.root?.message && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errors.root.message}
        </p>
      )}
      <Field id="email" label="E-mail" error={errors.email?.message}>
        {(a) => <Input {...a} {...register("email")} type="email" inputMode="email" autoComplete="username" autoFocus required />}
      </Field>
      <Field id="password" label="Senha" error={errors.password?.message}>
        {(a) => (
          <div className="relative">
            <Input {...a} {...register("password")} type={show ? "text" : "password"} autoComplete="current-password" required className="pr-11" />
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
      <div className="flex justify-end">
        <Link href="/esqueci-senha" className="text-xs font-medium text-primary underline-offset-2 hover:underline">
          Esqueceu sua senha?
        </Link>
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
        {pending ? "Entrando..." : "Entrar"}
      </Button>
    </form>
  );
}
