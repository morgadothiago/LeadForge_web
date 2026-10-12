"use client";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { POLL_INTERVAL_MS, POLL_MAX_MS } from "./plan-checkout-ui";
import { resolveUpgradeReturn, type UpgradeReturnView } from "./trial-ui";

/**
 * SPEC-034/065b (D-065-9.3, D-065-15) — retorno do checkout de UPGRADE (`?checkout=success|cancel`). A URL NUNCA libera nada (D-062-11):
 * quem decide e o status da assinatura lido do servidor (`paid` = `Subscription.status === "active"`, confirmado pelo webhook). Em
 * `success` sem pagamento confirmado mostra "Confirmando seu pagamento..." e faz polling (`router.refresh()` a cada 3 s por ate ~3 min,
 * sem action nova: a propria pagina e a leitura). Pago => toast + limpa a URL. Passou do tempo => "ainda nao confirmamos" (sem 2a cobranca).
 * A regiao `role="status"` anuncia as mudancas.
 */
export function CheckoutReturnHandler({ paid }: { paid: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const checkout = searchParams.get("checkout");
  const [timedOut, setTimedOut] = React.useState(false);
  const view = resolveUpgradeReturn(checkout, { paid, timedOut });

  React.useEffect(() => {
    if (checkout === "cancel") {
      toast.info("Checkout cancelado. Nenhuma cobrança foi feita.");
      router.replace(pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reagir só ao parâmetro; pathname/router mudam a cada navegação
  }, [checkout]);

  React.useEffect(() => {
    if (view !== "paid") return;
    toast.success("Pagamento confirmado. Seu plano já está ativo.");
    router.replace(pathname);
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  React.useEffect(() => {
    if (view !== "confirming") return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt >= POLL_MAX_MS) {
        clearInterval(timer);
        setTimedOut(true);
        return;
      }
      router.refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  return <UpgradeReturnNotice view={view} />;
}

const COPY: Record<Exclude<UpgradeReturnView, "idle" | "paid">, { icon: React.ComponentType<{ className?: string }>; tone: string; title: string; text: string }> = {
  confirming: { icon: Loader2, tone: "bg-primary/10 text-primary", title: "Confirmando seu pagamento...", text: "Isso costuma levar poucos segundos. Você não precisa fechar esta página." },
  timeout: { icon: Clock, tone: "bg-warning/15 text-warning", title: "Ainda não recebemos a confirmação", text: "Pode levar alguns minutos. Quando o pagamento for confirmado, você recebe um e-mail e o plano é liberado. Pode fechar esta página: nenhuma nova cobrança é feita." },
};

/** Parte visual (pura, testavel por SSR). */
export function UpgradeReturnNotice({ view }: { view: UpgradeReturnView }) {
  if (view === "idle") return null;
  if (view === "paid") {
    return (
      <div role="status" className="flex items-center gap-3 rounded-lg border border-success/40 bg-success/10 p-4 text-sm">
        <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden="true" />
        <p className="font-medium">Pagamento confirmado!</p>
      </div>
    );
  }
  const c = COPY[view];
  const Icon = c.icon;
  return (
    <div role="status" aria-live="polite" data-slot="upgrade-return" className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
      <span aria-hidden="true" className={`flex size-9 shrink-0 items-center justify-center rounded-full ${c.tone}`}>
        <Icon className={view === "confirming" ? "size-5 animate-spin" : "size-5"} />
      </span>
      <div className="space-y-1">
        <p className="font-medium">{c.title}</p>
        <p className="text-sm text-muted-foreground">{c.text}</p>
      </div>
    </div>
  );
}
