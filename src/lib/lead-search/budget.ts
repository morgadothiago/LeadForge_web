/**
 * SPEC-058: contagem ÚNICA de chamadas pagas do dia, usada por `reserve` (run.ts) e pelo painel (queries/lead-search.ts),
 * para o contador exibido ser sempre igual à regra que bloqueia. Run `running` conta no mínimo 1 chamada; `blocked` conta o que gravou (0).
 */
export interface BudgetRow {
  trigger: string;
  status: string;
  requests: number;
}

export const spentCalls = (rows: Pick<BudgetRow, "status" | "requests">[]): number =>
  rows.reduce((n, r) => n + (r.status === "running" ? Math.max(r.requests, 1) : r.requests), 0);

export interface BudgetLimits {
  daily: number;
  manual: number;
  org: number;
}

export interface BudgetSnapshot {
  /** Todas as origens, nesta campanha, hoje (o que o painel chama de `usedToday`). */
  usedToday: number;
  scheduledUsed: number;
  manualUsed: number;
  orgUsed: number;
  remainingManual: number;
  remainingOrg: number;
  /** Quantas chamadas pagas um OWNER ainda consegue disparar manualmente (min dos tetos manual e org). */
  estimatedPaidCallsLeft: number;
}

/** `campaignRows`: runs de hoje da campanha; `orgRows`: runs de hoje de TODAS as campanhas da org (manual + diária). */
export function computeBudget(campaignRows: BudgetRow[], orgRows: BudgetRow[], limits: BudgetLimits): BudgetSnapshot {
  const manualUsed = spentCalls(campaignRows.filter((r) => r.trigger === "manual"));
  const scheduledUsed = spentCalls(campaignRows.filter((r) => r.trigger !== "manual"));
  const orgUsed = spentCalls(orgRows);
  const remainingManual = Math.max(0, limits.manual - manualUsed);
  const remainingOrg = Math.max(0, limits.org - orgUsed);
  return {
    usedToday: manualUsed + scheduledUsed,
    scheduledUsed,
    manualUsed,
    orgUsed,
    remainingManual,
    remainingOrg,
    estimatedPaidCallsLeft: Math.min(remainingManual, remainingOrg),
  };
}
