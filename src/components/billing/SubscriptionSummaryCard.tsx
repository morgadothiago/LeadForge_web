"use client";
import * as React from "react";
import { toast } from "sonner";
import { CreditCard, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/components/leads/lead-format";
import { trialDaysLeft } from "@/lib/billing/trial-days";
import { createPortalSession } from "@/lib/actions/billing";
import type { BillingSummary } from "@/lib/queries/billing";
import { CancelSubscriptionPanel } from "./CancelSubscriptionPanel";
import { CADENCE_LABELS, SUBSCRIPTION_STATUS_LABELS, subscriptionStatusTone } from "./billing-format";
import { daysWord } from "./trial-ui";

const TONE_VARIANT = { ok: "default", warn: "muted", bad: "destructive" } as const;

/** SPEC-034 — cartão "plano atual" de Configurações > Assinatura: status, próxima cobrança e botão "Gerenciar assinatura" (abre o portal do provedor, SPEC-033). */
export function SubscriptionSummaryCard({ summary, now = new Date() }: { summary: BillingSummary; now?: Date }) {
  const [pending, startTransition] = React.useTransition();
  const { subscription, isOwner } = summary;

  function openPortal() {
    startTransition(async () => {
      const r = await createPortalSession();
      if (r.ok) {
        window.location.href = r.data.url;
        return;
      }
      toast.error(Object.values(r.errors).flat()[0] ?? "Não foi possível abrir o gerenciamento da assinatura.");
    });
  }

  if (!subscription) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Assinatura</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Nenhuma assinatura encontrada. Escolha um plano abaixo para começar.</p>
        </CardContent>
      </Card>
    );
  }

  const tone = subscriptionStatusTone(subscription.status);
  // SPEC-065b: no teste gratis (plano `free`) nao ha cobranca nem portal nem cancelamento: so o prazo e o convite ao upgrade.
  const onFreeTrial = subscription.planKey === "free" && subscription.status === "trialing";
  const daysLeft = onFreeTrial ? trialDaysLeft(subscription.trialEndsAt, now) : 0;
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle>Plano {subscription.planName}</CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={TONE_VARIANT[tone]}>{SUBSCRIPTION_STATUS_LABELS[subscription.status]}</Badge>
            {!onFreeTrial && <span>{CADENCE_LABELS[subscription.cadence]}</span>}
          </div>
        </div>
        <CreditCard className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </CardHeader>
      <CardContent className="space-y-3">
        {subscription.status === "trialing" && subscription.trialEndsAt && (
          <p className="text-sm">
            Teste grátis até <strong>{formatDate(subscription.trialEndsAt)}</strong>
            {onFreeTrial && daysLeft > 0 ? <> (faltam {daysWord(daysLeft)})</> : null}. Nenhuma cobrança até lá e nada é renovado sozinho.
          </p>
        )}
        {subscription.currentPeriodEnd && !subscription.cancelAtPeriodEnd && subscription.status !== "canceled" && (
          <p className="text-sm text-muted-foreground">
            Próxima cobrança em <strong className="text-foreground">{formatDate(subscription.currentPeriodEnd)}</strong>.
          </p>
        )}
        {onFreeTrial ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <a href="#planos" className={buttonVariants()}>
              Fazer upgrade
            </a>
            {!isOwner && <p className="text-xs text-muted-foreground">Somente o proprietário da organização pode assinar.</p>}
          </div>
        ) : (
          <>
            <CancelSubscriptionPanel subscription={subscription} isOwner={isOwner} />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button variant="outline" disabled={pending || !isOwner} aria-busy={pending} onClick={openPortal}>
                {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
                Gerenciar assinatura
              </Button>
              {!isOwner && <p className="text-xs text-muted-foreground">Somente o proprietário da organização gerencia a assinatura.</p>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
