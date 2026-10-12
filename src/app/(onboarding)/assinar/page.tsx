import type { Metadata } from "next";
import { PlanCheckoutSection } from "@/components/onboarding/PlanCheckoutSection";
import { resolveCadence, resolveIntentPlan } from "@/components/billing/plan-checkout-ui";
import { getPlanCheckoutState } from "@/lib/actions/billing";
import { firstParam, requireStageRoute } from "@/lib/auth/stage-guard";
import { listActivePlans } from "@/lib/billing/plans";

export const metadata: Metadata = { title: "Escolha seu plano | LeadForge", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * SPEC-062b — `/assinar`. Estados `sem_plano` e `aguardando_pagamento`; quem JÁ tem organização só entra com `?nova=1`
 * (2ª organização, D-062-14); pago sem organização vai a `/organizacao/nova` (nunca abre 2º checkout). `?plan=&cadence=` (intenção
 * vinda da landing) só pré-seleciona; `?checkout=cancel` mostra aviso. A verdade do estado vem do servidor, nunca da URL.
 */
export default async function AssinarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const another = firstParam(sp.nova) === "1";
  const { user, stage } = await requireStageRoute(another ? "/assinar?nova=1" : "/assinar");
  const [plans, state] = await Promise.all([listActivePlans(), getPlanCheckoutState()]);
  const shellStatus = state.ok && state.data.status !== "active" ? state.data.status : "none";
  return (
    <PlanCheckoutSection
      plans={plans}
      initialPlanKey={resolveIntentPlan(firstParam(sp.plan), plans)}
      initialCadence={resolveCadence(firstParam(sp.cadence))}
      email={user.email}
      emailVerified={user.emailVerified}
      cancelled={firstParam(sp.checkout) === "cancel"}
      another={another && (stage === "dono" || stage === "membro")}
      shellStatus={shellStatus}
    />
  );
}
