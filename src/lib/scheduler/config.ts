/** Configuração do scheduler (SPEC-013). Lê process.env a cada chamada; valores inválidos caem no default (nunca derrubam o app). */
export const MIN_CRON_SECRET_LENGTH = 32;
export const DEFAULT_TIME_BUDGET_MS = 50_000;
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
    timeBudgetMs: posInt(source.SCHEDULER_TIME_BUDGET_MS, DEFAULT_TIME_BUDGET_MS),
    maxSends: posInt(source.SCHEDULER_MAX_SENDS, DEFAULT_MAX_SENDS),
  };
}

/** null = ausente ou curto demais (o endpoint responde 503; nunca fica aberto). */
export function getCronSecret(source: Record<string, string | undefined> = process.env): string | null {
  const s = source.CRON_SECRET;
  return s && s.length >= MIN_CRON_SECRET_LENGTH ? s : null;
}
