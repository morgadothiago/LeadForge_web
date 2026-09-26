import { requireProviderOrg } from "@/lib/auth/require-admin";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";
import { integrationOrigin } from "@/lib/integrations/config";
import { startOfLocalDay } from "@/lib/whatsapp/send-window";
import { dailyRequestBudget, isSearchEnabled, maxResultsPerRun } from "@/lib/lead-search/config";

export interface SearchRunView {
  id: string;
  trigger: string;
  status: string;
  requests: number;
  found: number;
  created: number;
  duplicate: number;
  suppressed: number;
  invalid: number;
  error: string | null;
  startedAt: Date;
}

export type LeadSearchPanel =
  | { canManage: false }
  | { canManage: true; enabled: boolean; hasKey: boolean; budget: number; maxResults: number; usedToday: number; runs: SearchRunView[] };

/** Painel de busca da campanha. Nunca revela valor da chave. SPEC-030: `canManage` agora é "é provider desta org", não mais "role=admin". */
export async function getLeadSearchPanel(campaignId: string): Promise<LeadSearchPanel> {
  const { orgId } = await requireProviderOrg();
  const db = scopedPrisma(orgId);
  const start = startOfLocalDay("America/Sao_Paulo", new Date());
  const [origin, runs, used] = await Promise.all([
    integrationOrigin(orgId, "places"),
    db.searchRun.findMany({
      where: { campaignId },
      orderBy: { startedAt: "desc" },
      take: 10,
      select: { id: true, trigger: true, status: true, requests: true, found: true, created: true, duplicate: true, suppressed: true, invalid: true, error: true, startedAt: true },
    }),
    db.searchRun.aggregate({ where: { campaignId, startedAt: { gte: start } }, _sum: { requests: true } }),
  ]);
  return {
    canManage: true,
    enabled: isSearchEnabled(),
    hasKey: origin !== "none",
    budget: dailyRequestBudget(),
    maxResults: maxResultsPerRun(),
    usedToday: used._sum.requests ?? 0,
    runs,
  };
}
