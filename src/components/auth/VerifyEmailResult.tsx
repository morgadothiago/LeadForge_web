"use client";
import * as React from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, MailWarning } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { verifyEmail } from "@/lib/actions/auth";

type State = { kind: "loading" } | { kind: "ok" } | { kind: "error"; message: string };

/**
 * SPEC-055b — corpo da pagina publica `/verificar-email?token=...`. Confirma ao abrir (uma unica chamada; o guard por ref
 * evita o duplo efeito do StrictMode, que queimaria o token de uso unico). Sem token = erro direto, sem chamar a action.
 */
export function VerifyEmailResult({ token }: { token?: string }) {
  const [state, setState] = React.useState<State>(token ? { kind: "loading" } : { kind: "error", message: "Link de confirmação inválido. Solicite um novo link." });
  const started = React.useRef(false);
  const boxRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    verifyEmail({ token }).then((r) => {
      setState(r.ok ? { kind: "ok" } : { kind: "error", message: r.errors?._form?.[0] ?? "Link de confirmação inválido ou expirado. Solicite um novo link." });
    });
  }, [token]);

  React.useEffect(() => {
    if (state.kind !== "loading") boxRef.current?.focus();
  }, [state.kind]);

  if (state.kind === "loading")
    return (
      <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Confirmando seu e-mail…
      </div>
    );

  const ok = state.kind === "ok";
  return (
    <div className="space-y-4">
      <div
        ref={boxRef}
        tabIndex={-1}
        role={ok ? "status" : "alert"}
        className={`flex gap-3 rounded-lg border p-4 text-sm outline-none ${ok ? "border-success/40 bg-success/10" : "border-warning/40 bg-warning/10"}`}
      >
        {ok ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" /> : <MailWarning aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-warning" />}
        <div className="space-y-1">
          <p className="font-medium">{ok ? "E-mail confirmado" : "Não foi possível confirmar"}</p>
          <p className="text-muted-foreground">
            {ok ? "Tudo certo! Seu e-mail foi confirmado e você já pode enviar mensagens pelo LeadForge." : state.message}
          </p>
        </div>
      </div>
      <Link href={ok ? "/dashboard" : "/login"} className={buttonVariants({ size: "lg", className: "w-full" })}>
        {ok ? "Ir para o app" : "Ir para o login"}
      </Link>
      {!ok && <p className="text-center text-xs text-muted-foreground">Depois de entrar, use o aviso no topo da tela para reenviar o link.</p>}
    </div>
  );
}
