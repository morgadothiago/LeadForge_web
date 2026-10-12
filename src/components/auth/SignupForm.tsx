"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { getFormError } from "@/components/campaigns/form-utils";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { PasswordStrength } from "@/components/auth/PasswordStrength";
import { signUp } from "@/lib/actions/billing";
import { maskDocument } from "@/lib/domain/document-mask";
import { signupSchema, type SignupInput } from "@/lib/schemas/billing";

/**
 * SPEC-065b (D-065-21/23/27) — cadastro do teste gratis de 14 dias: nome, e-mail, CPF ou CNPJ (mascara + digitos verificadores no
 * cliente via `signupSchema`; o servidor valida de novo), senha, confirmar senha e forca (064). Cria usuario + organizacao e vai ao
 * dashboard. `plan`/`cadence` (intencao da landing) so viajam para o servidor, que os valida. react-hook-form + `zodResolver`.
 * Erros de campo e `_form` do servidor aparecem inline (role="alert") e em toast; o foco vai ao primeiro campo com erro.
 */
export function SignupForm({ plan, cadence }: { plan?: string; cadence?: "monthly" | "yearly" }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    control,
    formState: { errors },
  } = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    mode: "onTouched",
    defaultValues: { name: "", email: "", document: "", password: "", confirmPassword: "", plan, cadence },
  });

  const documentField = register("document");
  const [pw, nm, em] = useWatch({ control, name: ["password", "name", "email"] });

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const res = await signUp(values);
      if (!res.ok) {
        if (res.errors._form) setError("root", { type: "server", message: res.errors._form.join(" ") });
        let firstFieldKey: keyof SignupInput | undefined;
        for (const [key, msgs] of Object.entries(res.errors) as [string, string[]][]) {
          if (key === "_form") continue;
          firstFieldKey ??= key as keyof SignupInput;
          setError(key as keyof SignupInput, { type: "server", message: msgs.join(" ") });
        }
        toast.error(getFormError(res.errors));
        if (firstFieldKey) setFocus(firstFieldKey);
        return;
      }

      router.replace(res.data.redirectTo);
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {errors.root?.message && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errors.root.message}
        </p>
      )}
      <Field id="name" label="Nome" error={errors.name?.message}>
        {(a) => <Input {...a} {...register("name")} type="text" autoComplete="name" autoFocus required />}
      </Field>
      <Field id="email" label="E-mail" error={errors.email?.message}>
        {(a) => <Input {...a} {...register("email")} type="email" inputMode="email" autoComplete="email" required />}
      </Field>
      {/* SPEC-065 (D-065-27): so o hash do documento e guardado (anti-abuso: um teste por pessoa/empresa). Aviso de LGPD no hint. */}
      <Field
        id="document"
        label="CPF ou CNPJ"
        keepHint
        hint="Usamos só para limitar o teste a um por pessoa ou empresa. Guardamos apenas um código irreversível (hash), nunca o número."
        error={errors.document?.message}
      >
        {(a) => (
          <Input
            {...a}
            {...documentField}
            onChange={(e) => {
              e.target.value = maskDocument(e.target.value);
              void documentField.onChange(e);
            }}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="000.000.000-00 ou 00.000.000/0000-00"
            maxLength={18}
            required
          />
        )}
      </Field>
      <Field id="password" label="Senha" hint="Mínimo de 6 caracteres." error={errors.password?.message}>
        {(a) => <PasswordInput {...a} {...register("password")} required />}
      </Field>
      <PasswordStrength password={pw ?? ""} personal={[nm ?? "", em ?? ""]} />
      <Field id="confirmPassword" label="Confirmar senha" error={errors.confirmPassword?.message}>
        {(a) => <PasswordInput {...a} {...register("confirmPassword")} required />}
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
        {pending ? "Criando conta..." : "Criar conta"}
      </Button>
    </form>
  );
}
