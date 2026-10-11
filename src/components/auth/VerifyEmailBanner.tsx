"use client";
import * as React from "react";
import { Loader2, MailWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resendVerificationEmail } from "@/lib/actions/auth";
import { retryAfterSeconds, resendErrorMessage } from "./email-verification-ui";

type Feedback = { kind: "sent" | "verified" | "error"; text: string } | null;

/**
 * SPEC-055b (D-055-7) — faixa persistente no layout logado enquanto o e-mail nao foi confirmado. Nao tem botao de fechar
 * (some sozinha quando verificado, apos refresh). So o envio de mensagens e bloqueado; o resto do app segue liberado.
 */
export function VerifyEmailBanner({ email }: { email?: string }) {
  const [pending, startTransition] = React.useTransition();
  const [feedback, setFeedback] = React.useState<Feedback>(null);
  const [wait, setWait] = React.useState(0);

  React.useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  function resend() {
    setFeedback(null);
    startTransition(async () => {
      const r = await resendVerificationEmail();
      if (r.ok) {
        if (r.data.alreadyVerified) return setFeedback({ kind: "verified", text: "Seu e-mail já está confirmado. Atualize a página para liberar o envio de mensagens." });
        setWait(60);
        return setFeedback({ kind: "sent", text: `Enviamos um novo link${email ? ` para ${email}` : ""}. Confira também a caixa de spam.` });
      }
      const secs = retryAfterSeconds(r.errors);
      if (secs > 0) setWait(secs);
      setFeedback({ kind: "error", text: resendErrorMessage(r.errors) });
    });
  }

  const disabled = pending || wait > 0;
  return (
    <div className="border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm md:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <MailWarning className="size-4 shrink-0 text-warning" aria-hidden="true" />
        <p className="min-w-0 flex-1">Verifique seu e-mail para poder enviar mensagens. Enviamos um link de confirmação para sua caixa de entrada.</p>
        <Button type="button" size="sm" variant="outline" onClick={resend} disabled={disabled} aria-busy={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {wait > 0 && !pending ? `Reenviar em ${wait}s` : "Reenviar e-mail"}
        </Button>
      </div>
      <div className="min-h-0">
        {feedback && (
          <p role={feedback.kind === "error" ? "alert" : "status"} className={`mt-1 text-xs ${feedback.kind === "error" ? "text-destructive" : "text-muted-foreground"}`}>
            {feedback.text}
          </p>
        )}
      </div>
    </div>
  );
}
