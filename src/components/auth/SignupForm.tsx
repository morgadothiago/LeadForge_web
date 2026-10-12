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
import { signupSchema, type SignupInput } from "@/lib/schemas/billing";

/**
 * SPEC-062 (D-062-1/7) — cadastro SO com usuario: nome, e-mail e senha (MINIMO da 062a; a 062b refaz a tela). `plan`/`cadence`
 * (intencao vinda da landing) seguem ate o `/assinar` pela action `signUp`. react-hook-form + `zodResolver(signupSchema)`.
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
    defaultValues: { name: "", email: "", password: "", confirmPassword: "", plan, cadence },
  });

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
