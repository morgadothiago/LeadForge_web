"use client";
import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/campaigns/Field";
import { applyServerErrors } from "@/components/org/org-format";
import { joinByCode } from "@/lib/actions/org";
import { joinByCodeSchema } from "@/lib/schemas/org";
import type { z } from "zod";

type JoinCodeInput = z.input<typeof joinByCodeSchema>;
const FIELDS = ["code"] as const;

/**
 * SPEC-062b (D-062-15) — `/entrar-em-organizacao`: código de entrada digitado LOGADO (`joinByCode`; o cadastro não tem mais campo
 * de código). Entra SEM checkout (quem paga é a organização). Mensagem de erro genérica vinda do servidor (anti-oráculo).
 */
export function JoinByCodeForm() {
  const [pending, startTransition] = React.useTransition();
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors },
  } = useForm<JoinCodeInput>({ resolver: zodResolver(joinByCodeSchema), defaultValues: { code: "" } });

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const res = await joinByCode(values);
      if (res.ok) {
        window.location.assign(res.data.redirectTo);
        return;
      }
      toast.error(applyServerErrors(res.errors, setError, setFocus, FIELDS));
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {errors.root?.message && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errors.root.message}
        </p>
      )}
      <Field id="join-code" label="Código de entrada" hint="Peça o código a quem administra a organização." error={errors.code?.message}>
        {(a) => <Input {...a} {...register("code")} type="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} autoFocus required maxLength={64} className="font-mono tracking-wide" />}
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
        {pending ? "Entrando..." : "Entrar na organização"}
      </Button>
    </form>
  );
}
