import { AppError } from "@/lib/errors";

/**
 * SPEC-051 — configuracao dos criativos, lida de env a cada chamada (sem cache; testavel). Valores invalidos
 * de limites caem no default; provedor desconhecido ou `mock` nao-explicito em producao => erro tipado `config`
 * (a feature fica indisponivel, o app segue de pe).
 */
export const CREATIVE_PROVIDERS = ["mock"] as const;
export type CreativeProviderName = (typeof CREATIVE_PROVIDERS)[number];

export interface CreativeConfig {
  provider: CreativeProviderName;
  maxConcurrentJobsPerOrg: number;
  maxPerMonthPerOrg: number;
  maxDurationSec: number;
  maxScriptChars: number;
  blocklist: string[];
  jobTimeoutMs: number;
  jobMaxAttempts: number;
  /** So o mock: tempo ate o "video" ficar pronto. */
  mockDelayMs: number;
}

export const DEFAULTS = {
  maxConcurrentJobsPerOrg: 2,
  maxPerMonthPerOrg: 20,
  maxDurationSec: 120,
  maxScriptChars: 3000,
  jobTimeoutMs: 30 * 60_000,
  jobMaxAttempts: 120,
  mockDelayMs: 3000,
} as const;

function posInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return raw?.trim() && Number.isInteger(n) && n > 0 ? n : fallback;
}

export function getCreativeConfig(env: Record<string, string | undefined> = process.env): CreativeConfig {
  const explicit = env.CREATIVE_PROVIDER?.trim().toLowerCase();
  if (explicit && !(CREATIVE_PROVIDERS as readonly string[]).includes(explicit)) {
    throw new AppError({ code: "config", userMessage: "Geração de criativos indisponível no momento.", cause: new Error(`CREATIVE_PROVIDER inválido: ${explicit}`) });
  }
  // Mock em producao so com opt-in explicito (evita "gerar" videos de mentira por esquecimento de env).
  if (env.NODE_ENV === "production" && explicit !== "mock") {
    throw new AppError({ code: "config", userMessage: "Geração de criativos indisponível no momento.", cause: new Error("CREATIVE_PROVIDER não configurado em produção") });
  }
  return {
    provider: (explicit as CreativeProviderName | undefined) ?? "mock",
    maxConcurrentJobsPerOrg: posInt(env.CREATIVE_MAX_CONCURRENT_JOBS_PER_ORG, DEFAULTS.maxConcurrentJobsPerOrg),
    maxPerMonthPerOrg: posInt(env.CREATIVE_MAX_PER_MONTH_PER_ORG, DEFAULTS.maxPerMonthPerOrg),
    maxDurationSec: posInt(env.CREATIVE_MAX_DURATION_SEC, DEFAULTS.maxDurationSec),
    maxScriptChars: posInt(env.CREATIVE_MAX_SCRIPT_CHARS, DEFAULTS.maxScriptChars),
    blocklist: (env.CREATIVE_SCRIPT_BLOCKLIST ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    jobTimeoutMs: posInt(env.CREATIVE_JOB_TIMEOUT_MS, DEFAULTS.jobTimeoutMs),
    jobMaxAttempts: posInt(env.CREATIVE_JOB_MAX_ATTEMPTS, DEFAULTS.jobMaxAttempts),
    mockDelayMs: env.CREATIVE_MOCK_DELAY_MS?.trim() && Number.isInteger(Number(env.CREATIVE_MOCK_DELAY_MS)) && Number(env.CREATIVE_MOCK_DELAY_MS) >= 0 ? Number(env.CREATIVE_MOCK_DELAY_MS) : DEFAULTS.mockDelayMs,
  };
}
