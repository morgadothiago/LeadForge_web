"use client";
import * as React from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, MailWarning, TriangleAlert } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cancelAccountDeletionByToken, confirmAccountDeletion } from "@/lib/actions/account-deletion";
import { deletionErrorMessage, errorCode, formatDeletionDate, formatDeletionDateTime } from "./deletion-format";

export type DeletionLandingState =
  | { kind: "error"; message: string }
  /** Token inexistente/expirado/usado/de outro tipo: generico (nao distingue o motivo). */
  | { kind: "invalid" }
  | { kind: "confirm"; expiresAt: Date | string; windowDays: number }
  | { kind: "cancel"; scheduledFor: Date | string };

type Done = { kind: "confirmed"; scheduledFor: string; windowDays: number } | { kind: "cancelled" };

/**
 * SPEC-054b — corpo das paginas publicas `/conta/excluir/[token]` (confirmar) e `/conta/excluir/cancelar/[token]`
 * (cancelar). O link do e-mail so ABRE a pagina; a acao destrutiva/efetiva exige clicar no botao (GET nunca consome o
 * token). `invalid` e generico (invalido/expirado/ja usado).
 */
export function DeletionTokenLanding({ token, state }: { token: string; state: DeletionLandingState }) {
  const [done, setDone] = React.useState<Done | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string>();
  const [invalid, setInvalid] = React.useState(false);
  const statusRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (done || invalid) statusRef.current?.focus();
  }, [done, invalid]);

  if (done?.kind === "confirmed")
    return (
      <div className="space-y-4">
        <Result ref={statusRef} tone="success" title="Exclusão agendada">
          Sua conta será excluída em <strong className="text-foreground">{formatDeletionDate(done.scheduledFor)}</strong> ({done.windowDays} dias). Até lá ela fica bloqueada. Enviamos um e-mail com o link para cancelar, caso você mude de ideia.
        </Result>
        <Link href="/login" className={buttonVariants({ variant: "outline", className: "w-full" })}>
          Ir para o login
        </Link>
      </div>
    );
  if (done?.kind === "cancelled")
    return (
      <div className="space-y-4">
        <Result ref={statusRef} tone="success" title="Exclusão cancelada">
          Tudo certo: sua conta foi reativada e nada foi apagado. Você já pode entrar normalmente.
        </Result>
        <Link href="/login" className={buttonVariants({ size: "lg", className: "w-full" })}>
          Entrar na minha conta
        </Link>
      </div>
    );
  if (state.kind === "error")
    return <Result tone="warning" title="Não foi possível abrir o link">{state.message}</Result>;
  if (state.kind === "invalid" || invalid)
    return (
      <div className="space-y-4">
        <Result ref={statusRef} tone="warning" title="Link inválido ou expirado">
          Este link não pode mais ser usado (pode ter expirado ou já ter sido utilizado). Se ainda quiser excluir sua conta, faça um novo pedido em Configurações &gt; Conta. Se quiser cancelar uma exclusão agendada, entre pela tela de login.
        </Result>
        <Link href="/login" className={buttonVariants({ variant: "outline", className: "w-full" })}>
          Ir para o login
        </Link>
      </div>
    );

  function run() {
    setError(undefined);
    startTransition(async () => {
      if (state.kind === "confirm") {
        const r = await confirmAccountDeletion({ token });
        if (r.ok) return setDone({ kind: "confirmed", scheduledFor: new Date(r.data.scheduledFor).toISOString(), windowDays: r.data.windowDays });
        if (errorCode(r.errors) === "token_invalid") return setInvalid(true);
        return setError(deletionErrorMessage(r.errors));
      }
      const r = await cancelAccountDeletionByToken({ token });
      if (r.ok) return setDone({ kind: "cancelled" });
      if (errorCode(r.errors) === "token_invalid") return setInvalid(true);
      setError(deletionErrorMessage(r.errors));
    });
  }

  const isConfirm = state.kind === "confirm";
  return (
    <div className="space-y-4">
      <Result tone={isConfirm ? "danger" : "info"} title={isConfirm ? "Confirmar a exclusão da conta?" : "Cancelar a exclusão da conta?"}>
        {isConfirm ? (
          <>
            Ao confirmar, sua conta é bloqueada agora e excluída em definitivo em <strong className="text-foreground">{state.windowDays} dias</strong>. Nesse prazo você pode cancelar. Este link vale até {formatDeletionDateTime(state.expiresAt)}.
          </>
        ) : (
          <>
            Sua exclusão está agendada para <strong className="text-foreground">{formatDeletionDate(state.scheduledFor)}</strong>. Ao cancelar, sua conta volta a funcionar e nada é apagado.
          </>
        )}
      </Result>
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button size="lg" variant={isConfirm ? "destructive" : "default"} className="w-full" onClick={run} disabled={pending} aria-busy={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
        {isConfirm ? "Confirmar exclusão da conta" : "Cancelar a exclusão"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        <Link href="/login" className="font-medium text-primary underline-offset-2 hover:underline">
          Voltar ao login
        </Link>
      </p>
    </div>
  );
}

const TONES = {
  success: { box: "border-success/40 bg-success/10", icon: CheckCircle2, color: "text-success" },
  warning: { box: "border-warning/40 bg-warning/10", icon: MailWarning, color: "text-warning" },
  danger: { box: "border-destructive/40 bg-destructive/10", icon: TriangleAlert, color: "text-destructive" },
  info: { box: "border-border bg-muted/40", icon: TriangleAlert, color: "text-primary" },
} as const;

const Result = React.forwardRef<HTMLDivElement, { tone: keyof typeof TONES; title: string; children: React.ReactNode }>(function Result({ tone, title, children }, ref) {
  const t = TONES[tone];
  const Icon = t.icon;
  return (
    <div ref={ref} tabIndex={-1} role={tone === "warning" ? "alert" : "status"} aria-live="polite" className={`flex gap-3 rounded-lg border p-4 text-sm outline-none ${t.box}`}>
      <Icon aria-hidden="true" className={`mt-0.5 size-5 shrink-0 ${t.color}`} />
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground">{children}</p>
      </div>
    </div>
  );
});
