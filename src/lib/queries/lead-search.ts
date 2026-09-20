import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
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

/** Painel de busca da campanha. Não-admin recebe só `canManage:false` (sem dados). Nunca revela valor da chave. */
export async function getLeadSearchPanel(campaignId: string): Promise<LeadSearchPanel> {
  const user = await requireUser();
  if (user.role !== "admin") return { canManage: false };
  const start = startOfLocalDay("America/Sao_Paulo", new Date());
  const [origin, runs, used] = await Promise.all([
    integrationOrigin("places"),
    prisma.searchRun.findMany({
      where: { campaignId },
      orderBy: { startedAt: "desc" },
      take: 10,
      select: { id: true, trigger: true, status: true, requests: true, found: true, created: true, duplicate: true, suppressed: true, invalid: true, error: true, startedAt: true },
    }),
    prisma.searchRun.aggregate({ where: { campaignId, startedAt: { gte: start } }, _sum: { requests: true } }),
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
