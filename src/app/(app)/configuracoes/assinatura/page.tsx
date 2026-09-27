import * as React from "react";
import { Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { CheckoutReturnHandler } from "@/components/billing/CheckoutReturnHandler";
import { SubscriptionSummaryCard } from "@/components/billing/SubscriptionSummaryCard";
import { PlanSelectionSection } from "@/components/billing/PlanSelectionSection";
import { ForbiddenError } from "@/lib/auth/require-admin";
import { getBillingSummary } from "@/lib/queries/billing";
import { listActivePlans } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";

export default async function AssinaturaPage() {
  let data;
  try {
    const [summary, plans] = await Promise.all([getBillingSummary(), listActivePlans()]);
    data = { summary, plans };
  } catch (e) {
    if (e instanceof ForbiddenError || (e instanceof Error && e.message.includes("Sem permissão"))) {
      return (
        <Card role="alert" className="flex flex-col items-center gap-2 p-10 text-center">
          <Lock className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-heading text-lg font-semibold">Você não tem permissão para ver a assinatura</p>
          <p className="text-sm text-muted-foreground">Esta área é exclusiva de contas Provider com organização.</p>
        </Card>
      );
    }
    throw e;
  }

  const { summary, plans } = data;
  return (
    <div className="space-y-8">
      <React.Suspense fallback={null}>
        <CheckoutReturnHandler />
      </React.Suspense>
      <div>
        <h2 className="font-heading text-lg font-semibold">Assinatura</h2>
        <p className="text-sm text-muted-foreground">Plano atual, status da cobrança e opções de plano.</p>
      </div>

      <SubscriptionSummaryCard summary={summary} />

      <PlanSelectionSection
        plans={plans}
        currentPlanKey={summary.subscription?.planKey ?? null}
        hasSubscription={summary.subscription !== null && summary.orgStatus === "active"}
        isOwner={summary.isOwner}
      />
    </div>
  );
}
