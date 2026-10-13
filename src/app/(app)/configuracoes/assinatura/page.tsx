import * as React from "react";
import { Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { CheckoutReturnHandler } from "@/components/billing/CheckoutReturnHandler";
import { SubscriptionSummaryCard } from "@/components/billing/SubscriptionSummaryCard";
import { PlanSelectionSection } from "@/components/billing/PlanSelectionSection";
import { TrialBlockedPanel } from "@/components/billing/TrialBlockedPanel";
import { UsageMeter } from "@/components/billing/UsageMeter";
import { AiBudgetNotice } from "@/components/billing/AiBudgetNotice";
import { PlanComparison } from "@/components/billing/PlanComparison";
import { PlanFeaturesCard } from "@/components/billing/PlanFeaturesCard";
import { getAiBudget, getExtraUsage, getTenantEntitlements, type AiBudgetView, type TenantEntitlementsView } from "@/lib/queries/entitlements";
import type { UsageItem } from "@/components/billing/trial-ui";
import { ForbiddenError } from "@/lib/auth/require-admin";
import { requirePageUser } from "@/lib/auth/require-page";
import { getBillingSummary } from "@/lib/queries/billing";
import { getPlanUsage, type PlanUsage } from "@/lib/queries/usage";
import { listActivePlans } from "@/lib/billing/plans";
import { resolveCadence, resolveIntentPlan } from "@/components/billing/plan-checkout-ui";
import { firstParam } from "@/lib/auth/stage-guard";

export const dynamic = "force-dynamic";

/**
 * SPEC-034/065b — Configuracoes > Assinatura. Tres modos: (1) teste gratis ativo (resumo + medidor de uso + "Fazer upgrade"), (2) BLOQUEADO
 * (trial expirado: painel de bloqueio, dono x membro, escolha de plano para o dono; sem medidor: a org nao le dados), (3) assinante.
 * Pagina na allowlist do bloqueio total (D-065-14): `getBillingSummary` usa o guard `AllowExpired`.
 */
export default async function AssinaturaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const user = await requirePageUser();
  const blocked = user.platformRole === "provider" && user.orgAccess === "trial_expirado";
  let data;
  try {
    const [summary, plans, usage, extra, ent, ai] = await Promise.all([
      getBillingSummary(),
      listActivePlans(),
      blocked ? Promise.resolve<PlanUsage | null>(null) : getPlanUsage().catch(() => null),
      blocked ? Promise.resolve<UsageItem[]>([]) : getExtraUsage().catch(() => [] as UsageItem[]),
      blocked ? Promise.resolve<TenantEntitlementsView | null>(null) : getTenantEntitlements().catch(() => null),
      blocked ? Promise.resolve<AiBudgetView | null>(null) : getAiBudget().catch(() => null),
    ]);
    data = { summary, plans, usage, extra, ent, ai };
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

  const { summary, plans, usage, extra, ent, ai } = data;
  const sub = summary.subscription;
  const onTrial = sub?.status === "trialing";
  return (
    <div className="space-y-8">
      <React.Suspense fallback={null}>
        <CheckoutReturnHandler paid={sub?.status === "active"} />
      </React.Suspense>
      <div>
        <h2 className="font-heading text-lg font-semibold">Assinatura</h2>
        <p className="text-sm text-muted-foreground">
          {blocked ? "Seu acesso está pausado até a assinatura de um plano." : "Plano atual, uso, status da cobrança e opções de plano."}
        </p>
      </div>

      {blocked ? (
        <TrialBlockedPanel isOwner={summary.isOwner} ownerName={summary.ownerName} endedAt={sub?.trialEndsAt ?? null} neverGranted={summary.trialNeverGranted} />
      ) : (
        <SubscriptionSummaryCard summary={summary} />
      )}

      {ai && summary.isOwner && !blocked && <AiBudgetNotice budget={ai} />}

      {usage && (usage.items.some((i) => i.limit !== null) || extra.length > 0) && <UsageMeter items={usage.items} trialing={usage.trialing} extraItems={extra} />}

      {ent && !blocked && <PlanFeaturesCard view={ent} />}

      {/* Membro nao paga: no bloqueio nao ha o que escolher (so o proprietario assina). */}
      {!(blocked && !summary.isOwner) && (
        <PlanSelectionSection
          plans={plans}
          currentPlanKey={onTrial ? null : (sub?.planKey ?? null)}
          hasSubscription={sub !== null && summary.orgStatus === "active" && !onTrial}
          isOwner={summary.isOwner}
          trialing={onTrial && !blocked}
          blocked={blocked}
          initialPlanKey={resolveIntentPlan(firstParam(sp.plan), plans)}
          initialCadence={resolveCadence(firstParam(sp.cadence))}
        />
      )}

      {!(blocked && !summary.isOwner) && <PlanComparison columns={["free", "starter", "pro", "business"]} currentKey={sub?.planKey ?? null} />}
    </div>
  );
}
