"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { signUpAndJoin } from "@/lib/actions/org";
import { signupJoinFormSchema, type SignupJoinFormInput } from "@/lib/schemas/org";
import { applyServerErrors, parseJoinInput } from "@/components/org/org-format";
import { PasswordInput } from "./PasswordInput";

const FIELDS = ["name", "email", "password", "joinInput"] as const;

/**
 * SPEC-049b — signup "participar de uma organização" (sem checkout; a assinatura é da org). Um campo aceita o
 * código de entrada OU o link do convite: link -> segue para `/convite/[token]` (que usa o e-mail do convite);
 * código -> `signUpAndJoin({name,email,password,code})`. Anti-enumeração: exibe só a mensagem genérica do servidor
 * (código inválido e e-mail já cadastrado têm o mesmo texto, D-049-11) — nada é interpretado/diferenciado aqui.
 */
export function JoinWithCodeForm() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors },
  } = useForm<SignupJoinFormInput>({
    resolver: zodResolver(signupJoinFormSchema),
    defaultValues: { name: "", email: "", password: "", joinInput: "" },
  });

  const onSubmit = handleSubmit((values) => {
    const parsed = parseJoinInput(values.joinInput);
    if (parsed.kind === "token") {
      router.push(`/convite/${encodeURIComponent(parsed.token)}`);
      return;
    }
    startTransition(async () => {
      const res = await signUpAndJoin({ name: values.name, email: values.email, password: values.password, code: parsed.code });
      if (res.ok) {
        // Navegação completa: a sessão/org mudou, descarta qualquer cache de cliente.
        window.location.assign(res.data.redirectTo);
        return;
      }
      // Erros do campo `code`/`token` do servidor aparecem no campo do código/link.
      const mapped = Object.fromEntries(Object.entries(res.errors).map(([k, v]) => [k === "code" || k === "token" ? "joinInput" : k, v]));
      toast.error(applyServerErrors(mapped, setError, setFocus, FIELDS));
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Participar de uma organização">
      {errors.root?.message && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errors.root.message}
        </p>
      )}
      <Field id="join-input" label="Código de entrada ou link do convite" hint="Peça o código a um proprietário da organização, ou cole o link recebido por e-mail." error={errors.joinInput?.message}>
        {(a) => <Input {...a} {...register("joinInput")} type="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} autoFocus required />}
      </Field>
      <Field id="join-name" label="Nome" error={errors.name?.message}>
        {(a) => <Input {...a} {...register("name")} type="text" autoComplete="name" required />}
      </Field>
      <Field id="join-email" label="E-mail" error={errors.email?.message}>
        {(a) => <Input {...a} {...register("email")} type="email" inputMode="email" autoComplete="email" required />}
      </Field>
      <Field id="join-password" label="Senha" hint="Mínimo de 12 caracteres." error={errors.password?.message}>
        {(a) => <PasswordInput {...a} {...register("password")} required />}
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
        {pending ? "Entrando..." : "Criar conta e entrar"}
      </Button>
    </form>
  );
}
