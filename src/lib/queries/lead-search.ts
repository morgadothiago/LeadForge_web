import { requireProviderOrg } from "@/lib/auth/require-admin";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";
import { integrationOrigin } from "@/lib/integrations/config";
import { startOfLocalDay } from "@/lib/whatsapp/send-window";
import { prisma } from "@/lib/prisma";
import { computeBudget } from "@/lib/lead-search/budget";
import { dailyRequestBudget, isSearchEnabled, manualDailyBudget, maxResultsPerRun, orgDailyBudget, STALE_RUN_MS } from "@/lib/lead-search/config";

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

export interface ActiveRunView {
  id: string;
  trigger: string;
  startedAt: Date;
}

export type LeadSearchPanel =
  | { canManage: false }
  | {
      canManage: true;
      /** SPEC-058: papel do usuário na org; só `owner` dispara (a UI desabilita para `member`). */
      role: "owner" | "member";
      enabled: boolean;
      hasKey: boolean;
      /** Teto diário da busca agendada por campanha. */
      budget: number;
      maxResults: number;
      /** Chamadas pagas hoje na campanha (todas as origens), pela MESMA contagem do `reserve`. */
      usedToday: number;
      manualBudget: number;
      orgBudget: number;
      remainingManual: number;
      remainingOrg: number;
      /** min(remainingManual, remainingOrg): quantas buscas manuais ainda cabem hoje. */
      estimatedPaidCallsLeft: number;
      /** Run `running` (não preso) da campanha, se houver; sobrevive a refresh. */
      activeRun: ActiveRunView | null;
      /** SPEC-060: a última busca concluída deixou uma próxima página (botão vira "Buscar mais resultados"). */
      hasNextPage: boolean;
      runs: SearchRunView[];
    };

/** Painel de busca da campanha. Nunca revela valor da chave. SPEC-030: `canManage` agora é "é provider desta org", não mais "role=admin". */
export async function getLeadSearchPanel(campaignId: string): Promise<LeadSearchPanel> {
  const { user, orgId } = await requireProviderOrg();
  const db = scopedPrisma(orgId);
  const start = startOfLocalDay("America/Sao_Paulo", new Date());
  const [origin, runs, todayRows, orgRows, membership, cursorRun] = await Promise.all([
    integrationOrigin(orgId, "places"),
    db.searchRun.findMany({
      where: { campaignId },
      orderBy: { startedAt: "desc" },
      take: 10,
      select: { id: true, trigger: true, status: true, requests: true, found: true, created: true, duplicate: true, suppressed: true, invalid: true, error: true, startedAt: true },
    }),
    db.searchRun.findMany({ where: { campaignId, startedAt: { gte: start } }, select: { trigger: true, status: true, requests: true } }),
    db.searchRun.findMany({ where: { startedAt: { gte: start } }, select: { trigger: true, status: true, requests: true } }),
    prisma.membership.findUnique({ where: { userId_orgId: { userId: user.id, orgId } }, select: { orgRole: true } }),
    db.searchRun.findFirst({ where: { campaignId, status: "done", searchQuery: { not: null } }, orderBy: { startedAt: "desc" }, select: { pageToken: true } }),
  ]);
  const b = computeBudget(todayRows, orgRows, { daily: dailyRequestBudget(), manual: manualDailyBudget(), org: orgDailyBudget() });
  const cutoff = Date.now() - STALE_RUN_MS;
  const active = runs.find((r: SearchRunView) => r.status === "running" && r.startedAt.getTime() > cutoff);
  return {
    canManage: true,
    role: membership?.orgRole === "owner" ? "owner" : "member",
    enabled: isSearchEnabled(),
    hasKey: origin !== "none",
    budget: dailyRequestBudget(),
    maxResults: maxResultsPerRun(),
    usedToday: b.usedToday,
    manualBudget: manualDailyBudget(),
    orgBudget: orgDailyBudget(),
    remainingManual: b.remainingManual,
    remainingOrg: b.remainingOrg,
    estimatedPaidCallsLeft: b.estimatedPaidCallsLeft,
    activeRun: active ? { id: active.id, trigger: active.trigger, startedAt: active.startedAt } : null,
    hasNextPage: !!cursorRun?.pageToken,
    runs,
  };
}
