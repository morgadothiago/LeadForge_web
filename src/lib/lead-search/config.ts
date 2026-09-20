/** SPEC-015: DESLIGADA por padrão; exige LEAD_SEARCH_ENABLED=true E chave `places` cadastrada. Tetos conservadores. */
type Env = Record<string, string | undefined>;
export const HARD_MAX_RESULTS = 60;
const int = (v: string | undefined, d: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min ? Math.min(n, max) : d;
};
export const isSearchEnabled = (env: Env = process.env) => env.LEAD_SEARCH_ENABLED === "true";
/** Máximo de leads por execução. */
export const maxResultsPerRun = (env: Env = process.env) => int(env.LEAD_SEARCH_MAX_RESULTS, 20, 1, HARD_MAX_RESULTS);
/** Teto de chamadas pagas por campanha por dia (orçamento). */
export const dailyRequestBudget = (env: Env = process.env) => int(env.LEAD_SEARCH_DAILY_MAX_REQUESTS, 3, 1, 50);
/** Máx. de campanhas buscadas por tick (a busca roda síncrona no request do tick); sobras ficam para o próximo tick. */
export const maxCampaignsPerTick = (env: Env = process.env) => int(env.LEAD_SEARCH_MAX_CAMPAIGNS_PER_TICK, 3, 1, 50);
/** Prazo (ms) após o qual o tick não inicia novas buscas. */
export const tickDeadlineMs = (env: Env = process.env) => int(env.LEAD_SEARCH_TICK_DEADLINE_MS, 30000, 1000, 300000);
