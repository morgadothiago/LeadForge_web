"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, MailWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resendVerificationEmail } from "@/lib/actions/auth";
import { resendErrorMessage, retryAfterSeconds } from "@/components/auth/email-verification-ui";

type Feedback = { kind: "sent" | "verified" | "error"; text: string } | null;

/**
 * SPEC-062b (D-062-12/D-062-21) — estado do e-mail na tela sem organização: confirmado (selo) ou pendente (aviso + reenvio com
 * cooldown, mesma action `resendVerificationEmail` da 055). `id` liga o botão "Assinar" desabilitado (`aria-describedby`).
 */
export function EmailVerificationNotice({ id = "email-verification", email, verified, requiredToPay = false }: { id?: string; email: string; verified: boolean; requiredToPay?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [feedback, setFeedback] = React.useState<Feedback>(null);
  const [wait, setWait] = React.useState(0);

  React.useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  if (verified) {
    return (
      <p id={id} className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
        E-mail <strong className="break-all font-medium text-foreground">{email}</strong> confirmado.
      </p>
    );
  }

  function resend() {
    setFeedback(null);
    startTransition(async () => {
      const r = await resendVerificationEmail();
      if (r.ok) {
        if (r.data.alreadyVerified) {
          setFeedback({ kind: "verified", text: "Seu e-mail já está confirmado." });
          router.refresh();
          return;
        }
        setWait(60);
        setFeedback({ kind: "sent", text: `Enviamos um novo link para ${email}. Confira também a caixa de spam.` });
        return;
      }
      const secs = retryAfterSeconds(r.errors);
      if (secs > 0) setWait(secs);
      setFeedback({ kind: "error", text: resendErrorMessage(r.errors) });
    });
  }

  return (
    <div id={id} className="space-y-3 rounded-lg border border-warning/50 bg-warning/10 p-4 text-sm">
      <p className="flex items-start gap-2 font-medium">
        <MailWarning className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <span>
          {requiredToPay ? "Confirme seu e-mail para assinar." : "Seu e-mail ainda não foi confirmado."}
        </span>
      </p>
      <p className="text-muted-foreground">
        Enviamos um link de confirmação para <strong className="break-all font-medium text-foreground">{email}</strong>.
        {requiredToPay ? " Recibos e avisos de cobrança chegam nesse endereço, por isso confirmamos antes do pagamento." : ""}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" size="sm" variant="outline" onClick={resend} disabled={pending || wait > 0} aria-busy={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {wait > 0 && !pending ? `Reenviar em ${wait}s` : "Reenviar e-mail"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => router.refresh()}>
          Já confirmei, atualizar
        </Button>
      </div>
      {feedback && (
        <p role={feedback.kind === "error" ? "alert" : "status"} className={feedback.kind === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          {feedback.text}
        </p>
      )}
    </div>
  );
}
