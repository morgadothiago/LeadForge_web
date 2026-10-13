"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Field } from "@/components/campaigns/Field";
import { fieldError, getFormError } from "@/components/campaigns/form-utils";
import type { ActionResult, FieldErrors } from "@/lib/actions/result";

/** Campo de motivo (obrigatório em toda mudança de política; vai para a auditoria). */
export function ReasonField({ id, value, onChange, error }: { id: string; value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <Field id={id} label="Motivo da alteração" required error={error} hint="Fica registrado na auditoria (mín. 5 caracteres). Não coloque dados pessoais nem chaves.">
      {(a) => (
        <textarea
          {...a}
          rows={2}
          maxLength={500}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20 aria-invalid:border-destructive"
        />
      )}
    </Field>
  );
}

/**
 * Executa uma Server Action de política: `pending`, erros por campo, toast de sucesso/erro e `router.refresh()` (a página é server e relê a política).
 * Nunca recebe nem guarda segredo além do que o formulário digitou; quem chama limpa o campo `value` no sucesso.
 */
export function useAdminAction() {
  const router = useRouter();
  const [errors, setErrors] = React.useState<FieldErrors>();
  const [pending, startTransition] = React.useTransition();
  const run = React.useCallback(
    <T,>(call: () => Promise<ActionResult<T>>, successMessage: string, onOk?: (data: T) => void) => {
      setErrors(undefined);
      startTransition(async () => {
        const r = await call();
        if (r.ok) {
          toast.success(successMessage);
          onOk?.(r.data);
          router.refresh();
        } else {
          setErrors(r.errors);
          toast.error(getFormError(r.errors));
        }
      });
    },
    [router],
  );
  return { run, errors, pending, setErrors };
}

export function FormError({ errors }: { errors: FieldErrors | undefined }) {
  const msg = fieldError(errors, "_form");
  if (!msg) return null;
  return (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {msg}
    </p>
  );
}

export function Section({ title, description, children, action }: { title: string; description?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-heading text-base font-semibold">{title}</h3>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
