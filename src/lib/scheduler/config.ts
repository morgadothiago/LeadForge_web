/** Configuração do scheduler (SPEC-013). Lê process.env a cada chamada; valores inválidos caem no default (nunca derrubam o app). */
export const MIN_CRON_SECRET_LENGTH = 32;
/** maxDuration (s) da rota /api/cron/tick; o literal em route.ts deve ser igual (teste garante). */
export const ROUTE_MAX_DURATION_S = 60;
/** Pior caso de UM envio já iniciado (SMTP: conexão 8 s + greeting 8 s + socket 15 s; WhatsApp: timeout do provider). */
export const SEND_WORST_CASE_MS = 30_000;
/** Folga para lock/release/atualização final do SchedulerRun. */
export const BUDGET_MARGIN_MS = 5_000;
/** Teto do orçamento efetivo: nenhum envio INICIA se puder terminar além de maxDuration. */
export const MAX_EFFECTIVE_BUDGET_MS = ROUTE_MAX_DURATION_S * 1000 - SEND_WORST_CASE_MS - BUDGET_MARGIN_MS;
export const DEFAULT_TIME_BUDGET_MS = 25_000;
export const DEFAULT_MAX_SENDS = 20;

export interface SchedulerConfig {
  timeBudgetMs: number;
  maxSends: number;
}

function posInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return raw && Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function getSchedulerConfig(source: Record<string, string | undefined> = process.env): SchedulerConfig {
  return {
    timeBudgetMs: Math.min(posInt(source.SCHEDULER_TIME_BUDGET_MS, DEFAULT_TIME_BUDGET_MS), MAX_EFFECTIVE_BUDGET_MS),
    maxSends: posInt(source.SCHEDULER_MAX_SENDS, DEFAULT_MAX_SENDS),
  };
}

/** null = ausente ou curto demais (o endpoint responde 503; nunca fica aberto). */
export function getCronSecret(source: Record<string, string | undefined> = process.env): string | null {
  const s = source.CRON_SECRET;
  return s && s.length >= MIN_CRON_SECRET_LENGTH ? s : null;
}
