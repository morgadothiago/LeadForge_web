"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, Loader2, TriangleAlert } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getPlanCheckoutState, type PlanCheckoutState } from "@/lib/actions/billing";
import { POLL_INTERVAL_MS, POLL_MAX_MS, resolveReturnView, type ReturnView } from "@/components/billing/plan-checkout-ui";
import { cn } from "@/lib/utils";

const REDIRECT_DELAY_MS = 1500;

/**
 * SPEC-062b (D-062-11) — `/assinar/retorno`: consulta `getPlanCheckoutState` a cada 3 s por até ~3 min. A VERDADE é a
 * assinatura da casca (webhook); `?checkout=success` na URL não participa (esta tela nem lê o parâmetro). Estados:
 * confirmando / pago (vai a `/organizacao/nova`) / falha / sem pagamento / ainda não confirmado (timeout) / erro de consulta.
 * A região `role="status"` anuncia as mudanças (aria-live) e o título recebe foco nos estados finais.
 */
export function CheckoutReturn() {
  const router = useRouter();
  const [status, setStatus] = React.useState<PlanCheckoutState["status"] | null>(null);
  const [timedOut, setTimedOut] = React.useState(false);
  const [requestFailed, setRequestFailed] = React.useState(false);
  const [round, setRound] = React.useState(0);
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    async function tick() {
      const r = await getPlanCheckoutState().catch(() => null);
      if (cancelled) return;
      if (!r || !r.ok) {
        setRequestFailed(true);
        return;
      }
      setRequestFailed(false);
      setStatus(r.data.status);
      if (r.data.status !== "incomplete") return;
      if (Date.now() - startedAt >= POLL_MAX_MS) {
        setTimedOut(true);
        return;
      }
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    }
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [round]);

  const view: ReturnView = resolveReturnView(status, { timedOut, requestFailed });

  React.useEffect(() => {
    if (view !== "confirming") headingRef.current?.focus();
  }, [view]);

  React.useEffect(() => {
    if (view !== "paid") return;
    const t = setTimeout(() => router.replace("/organizacao/nova"), REDIRECT_DELAY_MS);
    return () => clearTimeout(t);
  }, [view, router]);

  function checkAgain() {
    setStatus(null);
    setTimedOut(false);
    setRequestFailed(false);
    setRound((n) => n + 1);
  }

  return <CheckoutReturnView view={view} onCheckAgain={checkAgain} headingRef={headingRef} />;
}

/** Parte visual (pura, testavel por SSR): um estado -> textos e acoes. */
export function CheckoutReturnView({ view, onCheckAgain, headingRef }: { view: ReturnView; onCheckAgain: () => void; headingRef?: React.Ref<HTMLHeadingElement> }) {
  const copy = VIEW_COPY[view];
  const Icon = copy.icon;
  return (
    <Card className="mx-auto w-full max-w-lg space-y-5 p-6 text-center sm:p-8">
      <div role="status" aria-live="polite" className="space-y-3">
        <span aria-hidden="true" className={cn("mx-auto flex size-12 items-center justify-center rounded-full", copy.tone)}>
          <Icon className={cn("size-6", view === "confirming" && "animate-spin")} />
        </span>
        <h1 ref={headingRef} tabIndex={-1} className="font-heading text-xl font-semibold outline-none sm:text-2xl">
          {copy.title}
        </h1>
        <p className="text-sm text-muted-foreground">{copy.text}</p>
      </div>
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:justify-center">
        {view === "paid" && (
          <Link href="/organizacao/nova" className={buttonVariants()}>
            Continuar
          </Link>
        )}
        {(view === "timeout" || view === "error") && (
          <Button type="button" onClick={onCheckAgain}>
            Verificar de novo
          </Button>
        )}
        {(view === "failed" || view === "none" || view === "timeout" || view === "confirming") && (
          <Link href="/assinar" className={buttonVariants({ variant: view === "timeout" || view === "confirming" ? "outline" : "default", size: view === "confirming" ? "sm" : "default" })}>
            {view === "none" ? "Escolher um plano" : "Voltar aos planos"}
          </Link>
        )}
      </div>
    </Card>
  );
}

const VIEW_COPY: Record<ReturnView, { icon: React.ComponentType<{ className?: string }>; tone: string; title: string; text: string }> = {
  confirming: { icon: Loader2, tone: "bg-primary/10 text-primary", title: "Confirmando seu pagamento...", text: "Isso costuma levar poucos segundos. Não feche esta página." },
  paid: { icon: CheckCircle2, tone: "bg-success/15 text-success", title: "Pagamento confirmado!", text: "Agora falta só dar um nome para a sua organização. Levando você para lá..." },
  failed: { icon: TriangleAlert, tone: "bg-destructive/10 text-destructive", title: "O pagamento não foi concluído", text: "Nenhuma organização foi criada. Você pode escolher o plano de novo e tentar com outro cartão." },
  none: { icon: Clock, tone: "bg-muted text-muted-foreground", title: "Não encontramos um pagamento em andamento", text: "Escolha um plano para continuar." },
  timeout: { icon: Clock, tone: "bg-warning/15 text-warning", title: "Ainda não recebemos a confirmação", text: "Pode levar alguns minutos. Quando o pagamento for confirmado, você recebe um e-mail e pode voltar aqui. Pode fechar esta página sem medo: nenhuma nova cobrança é feita." },
  error: { icon: TriangleAlert, tone: "bg-destructive/10 text-destructive", title: "Não foi possível consultar o pagamento", text: "Verifique sua conexão e tente de novo." },
};
