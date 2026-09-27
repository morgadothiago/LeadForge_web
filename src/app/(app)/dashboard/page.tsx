import { Suspense } from "react";
import { requirePageProviderOrg } from "@/lib/auth/require-page";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";
import { parseDashboardParams } from "@/lib/queries/dashboard";
import { DashboardContent } from "@/components/dashboard/DashboardContent";
import { DashboardFilters } from "@/components/dashboard/DashboardFilters";
import { DashboardSkeleton } from "@/components/dashboard/DashboardSkeleton";

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
  const params = parseDashboardParams(await searchParams);
  const { orgId } = await requirePageProviderOrg();
  const campaigns = await scopedPrisma(orgId).campaign.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return (
    <div className="space-y-6">
      <DashboardFilters params={params} campaigns={campaigns} />
      <Suspense key={`${params.period}:${params.campaignId ?? ""}`} fallback={<DashboardSkeleton />}>
        <DashboardContent params={params} />
      </Suspense>
    </div>
  );
}
