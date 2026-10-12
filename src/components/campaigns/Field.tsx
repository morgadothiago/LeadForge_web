import * as React from "react";

/** Label + controle + erro acessível. `children` recebe ids/aria para aplicar ao controle. */
export function Field({
  id,
  label,
  error,
  hint,
  keepHint,
  required,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  /** Mantem a dica visivel (e no aria-describedby) mesmo com erro de campo (ex.: aviso de LGPD do CPF/CNPJ). */
  keepHint?: boolean;
  required?: boolean;
  children: (a: { id: string; "aria-invalid": boolean; "aria-describedby": string | undefined }) => React.ReactNode;
}) {
  const descId = [error ? `${id}-error` : null, hint && (keepHint || !error) ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required && (
          <span aria-hidden="true" className="ml-0.5 text-destructive">
            *
          </span>
        )}
      </label>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": descId })}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {hint && (keepHint || !error) ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
