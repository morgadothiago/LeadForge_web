"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlanCard } from "@/components/billing/PlanCard";
import { SALES_CONTACT_HREF } from "@/components/billing/sales-contact";
import { checkoutErrorInfo, type Cadence, type CheckoutErrorInfo } from "@/components/billing/plan-checkout-ui";
import { startPlanCheckout } from "@/lib/actions/billing";
import type { PlanView } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";
import { CancelPendingSubscription } from "./CancelPendingSubscription";
import { EmailVerificationNotice } from "./EmailVerificationNotice";

export interface PlanCheckoutSectionProps {
  plans: PlanView[];
  /** Plano de intenção vindo da landing (`?plan=`), já validado contra a lista. */
  initialPlanKey: string | null;
  initialCadence: Cadence;
  email: string;
  emailVerified: boolean;
  /** `?checkout=cancel`: voltou do provedor sem pagar. */
  cancelled: boolean;
  /** `?nova=1`: usuário que já tem organização e quer outra (D-062-14). */
  another: boolean;
  /** Estado da casca de cobrança do usuário (D-062-18): `incomplete` = pagamento iniciado e ainda não confirmado. */
  shellStatus: "none" | "incomplete" | "past_due" | "canceled";
}

/**
 * SPEC-062b (D-062-9/10/12/24) — `/assinar`: escolher plano + cadência e abrir o checkout (SÓ cartão; sem UI de PIX). Plano
 * "Business" = falar com vendas. E-mail não confirmado: aviso + reenvio e botão "Assinar" desabilitado (D-062-12).
 * Erros tipados de `startPlanCheckout` aparecem num `role="alert"` com foco.
 */
export function PlanCheckoutSection({ plans, initialPlanKey, initialCadence, email, emailVerified, cancelled, another, shellStatus }: PlanCheckoutSectionProps) {
  const router = useRouter();
  const [cadence, setCadence] = React.useState<Cadence>(initialCadence);
  const [loadingKey, setLoadingKey] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  // Mantem o estado "abrindo pagamento" (botoes desabilitados) ate o navegador sair da pagina; so volta se a action falhar.
  const [navigating, setNavigating] = React.useState(false);
  const [error, setError] = React.useState<CheckoutErrorInfo | null>(null);
  const [serverUnverified, setServerUnverified] = React.useState(false);
  const unverified = !emailVerified || serverUnverified;
  const errorRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function subscribe(planKey: string) {
    setError(null);
    setLoadingKey(planKey);
    startTransition(async () => {
      const r = await startPlanCheckout({ planKey, cadence }).catch(() => null);
      if (!r) {
        setLoadingKey(null);
        setNavigating(false);
        setError(checkoutErrorInfo({ code: ["billing_unavailable"] }));
        return;
      }
      if (r.ok) {
        if ("url" in r.data) {
          setNavigating(true);
          window.location.href = r.data.url;
          return; // mantém o estado "abrindo pagamento" até o navegador sair da página
        }
        setNavigating(true);
        router.replace(r.data.redirectTo);
        return;
      }
      const info = checkoutErrorInfo(r.errors);
      if (info.code === "email_unverified") setServerUnverified(true);
      setLoadingKey(null);
      setNavigating(false);
      setError(info);
    });
  }

  const canPay = !unverified;
  const intentName = plans.find((p) => p.key === initialPlanKey)?.name;

  return (
    <section aria-labelledby="assinar-h" className="space-y-6">
      <div className="space-y-2 text-center sm:text-left">
        <h1 id="assinar-h" className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">
          {another ? "Escolha o plano da nova organização" : "Escolha seu plano"}
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
          {another
            ? "Cada organização tem a sua própria assinatura. Depois de pagar, você dá um nome à nova organização."
            : "Para criar sua organização e usar o LeadForge, escolha um plano e conclua o pagamento no cartão. Depois do pagamento você dá um nome à sua organização."}
        </p>
        {intentName && !another && <p className="text-sm text-muted-foreground">Você demonstrou interesse no plano {intentName}; confira e confirme abaixo.</p>}
      </div>

      {cancelled && (
        <p role="status" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Pagamento cancelado. Nenhuma cobrança foi feita. Você pode escolher um plano de novo quando quiser.
        </p>
      )}
      {shellStatus === "incomplete" && !cancelled && (
        <div role="status" className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground">Seu pagamento ainda não foi confirmado. Você pode tentar de novo, trocar de plano ou conferir o status.</p>
          <Link href="/assinar/retorno" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}>
            Ver status do pagamento
          </Link>
        </div>
      )}
      {shellStatus === "past_due" && (
        <div role="alert" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="font-medium text-destructive">Não conseguimos confirmar o último pagamento.</p>
          <p className="text-muted-foreground">Escolha o plano e tente de novo com outro cartão, ou cancele a assinatura.</p>
          <CancelPendingSubscription />
        </div>
      )}

      {unverified && <EmailVerificationNotice email={email} verified={false} requiredToPay />}

      {error && error.code !== "email_unverified" && (
        <div ref={errorRef} tabIndex={-1} role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <div>
            <p className="font-medium text-destructive">{error.title}</p>
            <p className="text-muted-foreground">{error.message}</p>
          </div>
        </div>
      )}

      <div className="flex justify-center sm:justify-start">
        <Tabs value={cadence} onValueChange={(v) => setCadence(v as Cadence)}>
          <TabsList aria-label="Cadência de cobrança">
            <TabsTrigger value="monthly">Mensal</TabsTrigger>
            <TabsTrigger value="yearly">Anual</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {plans.length === 0 ? (
        <p role="status" className="text-center text-sm text-muted-foreground">
          Nenhum plano disponível no momento. Fale com a gente: <a className="underline-offset-2 hover:underline" href={SALES_CONTACT_HREF}>contato@leadforge.com</a>.
        </p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => {
            const isIntent = initialPlanKey === plan.key;
            const busy = (pending || navigating) && loadingKey === plan.key;
            return (
              <PlanCard
                key={plan.key}
                plan={plan}
                cadence={cadence}
                highlighted={initialPlanKey ? isIntent : plan.key === "pro"}
                highlightLabel={initialPlanKey ? "Escolhido por você" : "Mais popular"}
                footer={
                  plan.selfServiceCheckout ? (
                    <Button
                      className="w-full"
                      disabled={pending || navigating || !canPay}
                      aria-busy={busy}
                      aria-describedby={!canPay ? "email-verification" : undefined}
                      onClick={() => subscribe(plan.key)}
                    >
                      {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
                      {busy ? "Abrindo pagamento..." : `Assinar ${plan.name}`}
                    </Button>
                  ) : (
                    <a href={SALES_CONTACT_HREF} className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
                      Falar com vendas
                    </a>
                  )
                }
              />
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">Pagamento no cartão, em ambiente seguro do provedor de pagamento. Você será levado à página dele e volta aqui em seguida.</p>

      <div className="flex flex-col gap-2 border-t border-border pt-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          Recebeu um convite ou um código de uma organização?{" "}
          <Link href="/entrar-em-organizacao" className="font-medium text-primary underline-offset-2 hover:underline">
            Entrar em uma organização
          </Link>
          . Sem pagar: quem paga é a organização.
        </p>
        {another && (
          <Link href="/dashboard" className="font-medium text-primary underline-offset-2 hover:underline">
            Voltar ao painel
          </Link>
        )}
      </div>
    </section>
  );
}
