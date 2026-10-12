import { Suspense } from "react";
import { cookies } from "next/headers";
import { requirePageProviderOrg } from "@/lib/auth/require-page";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";
import { parseDashboardParams } from "@/lib/queries/dashboard";
import { DashboardContent } from "@/components/dashboard/DashboardContent";
import { DashboardFilters } from "@/components/dashboard/DashboardFilters";
import { DashboardSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { OrgNameCard } from "@/components/dashboard/OrgNameCard";
import { GettingStartedCard } from "@/components/dashboard/GettingStartedCard";
import { getDashboardOnboarding } from "@/lib/queries/onboarding";
import { PlanIntentNote } from "@/components/dashboard/PlanIntentNote";
import { resolveCadence, resolveIntentPlan } from "@/components/billing/plan-checkout-ui";
import { listActivePlans } from "@/lib/billing/plans";
import { firstParam } from "@/lib/auth/stage-guard";
import { isOnboardingDismissed, onboardingCookieName } from "@/lib/onboarding-state";

export const dynamic = "force-dynamic";

/**
 * SPEC-030/037 (correção de achado real): antes desta correção, a lista de campanhas do filtro
 * vinha de `prisma.campaign.findMany` cru (sem `orgId`) — um `provider` via TODAS as campanhas de
 * TODAS as organizações no dropdown de filtro (vazamento cross-tenant real, não hipotético). Corrigido
 * para `requireProviderOrg()` + `scopedPrisma(orgId)`. `/dashboard` é exclusivo de `provider`
 * (`platform_admin` não tem `orgId` — home dele é `/admin/organizacoes`, ver `homeRouteFor()`); usar
 * `requireProviderOrg()` aqui também corrige o 500/erro não tratado que `platform_admin` via ao cair
 * nesta rota (agora nunca deveria cair aqui, mas se cair, recebe o mesmo `ForbiddenError` tratado
 * que o resto do app).
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = parseDashboardParams(sp);
  const { orgId } = await requirePageProviderOrg();
  const campaigns = await scopedPrisma(orgId).campaign.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  // SPEC-065b (D-065-22/23): cartoes de primeiro acesso (nome da empresa, primeiros passos). A leitura nunca derruba o dashboard.
  const onb = await getDashboardOnboarding().catch(() => null);
  const jar = await cookies();
  const showName = Boolean(onb && onb.isOwner && onb.hasDefaultName && !isOnboardingDismissed(jar.get(onboardingCookieName("name", orgId))?.value));
  const showSteps = Boolean(onb && !isOnboardingDismissed(jar.get(onboardingCookieName("steps", orgId))?.value));
  // Intencao de plano da landing (so apos o cadastro): valida contra os planos self-service; invalido e ignorado.
  const intentRaw = firstParam(sp.plan);
  const intentPlans = intentRaw ? await listActivePlans().catch(() => []) : [];
  const intentKey = resolveIntentPlan(intentRaw, intentPlans);
  const intentPlan = intentKey ? intentPlans.find((p) => p.key === intentKey) : undefined;
  return (
    <div className="space-y-6">
      {intentPlan && <PlanIntentNote planName={intentPlan.name} planKey={intentPlan.key} cadence={resolveCadence(firstParam(sp.cadence))} />}
      {onb && showName && <OrgNameCard orgId={orgId} currentName={onb.orgName} />}
      {onb && showSteps && <GettingStartedCard orgId={orgId} steps={onb.steps} />}
      <DashboardFilters params={params} campaigns={campaigns} />
      <Suspense key={`${params.period}:${params.campaignId ?? ""}`} fallback={<DashboardSkeleton />}>
        <DashboardContent params={params} />
      </Suspense>
    </div>
  );
}
