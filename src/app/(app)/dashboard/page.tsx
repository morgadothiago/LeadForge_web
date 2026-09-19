import { Suspense } from "react";
import { requireUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/prisma";
import { parseDashboardParams } from "@/lib/queries/dashboard";
import { DashboardContent } from "@/components/dashboard/DashboardContent";
import { DashboardFilters } from "@/components/dashboard/DashboardFilters";
import { DashboardSkeleton } from "@/components/dashboard/DashboardSkeleton";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseDashboardParams(await searchParams);
  await requireUser();
  const campaigns = await prisma.campaign.findMany({
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
