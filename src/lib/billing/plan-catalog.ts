/**
 * SPEC-069a (D-069-4/5) — CATALOGO unico de funcionalidades e limites por plano. PURO (sem prisma/next): o seed (`prisma/seed.ts`) e o
 * modulo `entitlements` leem DAQUI. Os valores abaixo sao PLACEHOLDER (aprovados como proposta, Q-069-4): para mudar um numero ou
 * liberar/bloquear uma funcionalidade, edite SO este arquivo e rode o seed — nenhum codigo de checagem muda (AC-5).
 */

export const PLAN_KEYS = ["free", "starter", "pro", "business", "courtesy"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

/** Ordem de "menor para maior" usada para dizer qual plano libera uma funcionalidade. */
export const PLAN_ORDER: readonly PlanKey[] = ["free", "starter", "pro", "business"];

/**
 * SPEC-069b: identidade do plano de TESTE (trial de 14 dias, SPEC-065). Unico lugar autorizado a conhecer a chave `free` fora do seed:
 * semantica de trial (cancelar/excluir conta), nunca permissao de funcionalidade (isso e `entitlements.ts`).
 */
export const FREE_PLAN_KEY: PlanKey = "free";
export const isFreePlanKey = (key: string | null | undefined): boolean => key === FREE_PLAN_KEY;

/** Planos com TUDO liberado e sem limites (D-065-25 preservado): independem do que estiver gravado em `Plan.limits`. */
export const FULL_ACCESS_PLAN_KEYS: readonly string[] = ["business", "courtesy"];

export const PLAN_DISPLAY_NAMES: Record<PlanKey, string> = { free: "Teste grátis", starter: "Starter", pro: "Pro", business: "Business", courtesy: "Cortesia" };

// ---------------------------------------------------------------------------------------------------------------------------------
// Funcionalidades (booleanas). `costly` = custam dinheiro/risco (IA): pausam em `past_due` (D-069-10) e sao fail-closed (D-069-9).
// ---------------------------------------------------------------------------------------------------------------------------------
export const FEATURE_CATALOG = {
  "agents.role.sdr": { label: "Agente SDR", costly: true },
  "agents.role.followup": { label: "Agente de follow-up", costly: true },
  "agents.role.closer": { label: "Agente Closer", costly: true },
  "agents.autonomy.draft": { label: "Agentes em modo rascunho (aprovação humana)", costly: true },
  "agents.autonomy.sample": { label: "Agentes com amostragem", costly: true },
  "agents.autonomy.auto": { label: "Agentes em modo automático", costly: true },
  "llm.byok": { label: "Provedor de IA próprio (BYOK)", costly: true },
  "sources.ads": { label: "Fontes Google Ads Lead Form e Meta Lead Ads", costly: false },
  "ingest.api": { label: "Ingestão externa por API (n8n)", costly: false },
  "inbox.read": { label: "Caixa de atendimento (leitura)", costly: false },
  "inbox.reply": { label: "Caixa de atendimento: responder", costly: false },
  "inbox.attachments": { label: "Caixa de atendimento: anexos", costly: false },
  "inbox.labels": { label: "Caixa de atendimento: etiquetas", costly: false },
} as const satisfies Record<string, { label: string; costly: boolean }>;

export type FeatureKey = keyof typeof FEATURE_CATALOG;
export const FEATURE_KEYS = Object.keys(FEATURE_CATALOG) as FeatureKey[];
export function isFeatureKey(k: string): k is FeatureKey {
  return Object.prototype.hasOwnProperty.call(FEATURE_CATALOG, k);
}
/** Leitura: continua liberada mesmo com plano bloqueado/expirado (fail-open so em leitura, D-069-9). */
export const READ_ONLY_FEATURES: readonly FeatureKey[] = ["inbox.read"];

// ---------------------------------------------------------------------------------------------------------------------------------
// Limites numericos. `null` explicito = ilimitado. Chave AUSENTE: as 5 legadas = ilimitado (D-065-8); as novas seguem `absent` abaixo.
// ---------------------------------------------------------------------------------------------------------------------------------
export const LEGACY_LIMIT_KEYS = ["maxCampaigns", "maxWhatsappInstances", "maxEmailAccounts", "maxLeadsPerMonth", "maxSendsPerDay"] as const;

/** `absent: "zero"` = chave ausente vale 0 (fail-closed: custa dinheiro/risco); `"unlimited"` = ausente vale ilimitado. */
export const NEW_LIMIT_CATALOG = {
  maxActiveAgents: { label: "Agentes ativos ao mesmo tempo", absent: "zero" },
  maxAiBudgetCentsMonth: { label: "Teto de custo de IA por mês (centavos)", absent: "zero" },
  maxAgentMessagesPerDay: { label: "Mensagens por dia por agente", absent: "zero" },
  maxLeadSearchesPerDay: { label: "Buscas de leads por dia", absent: "zero" },
  maxCreativesPerMonth: { label: "Criativos por mês", absent: "zero" },
  maxMembers: { label: "Membros da equipe", absent: "unlimited" },
  maxSequenceSteps: { label: "Passos por sequência", absent: "unlimited" },
} as const satisfies Record<string, { label: string; absent: "zero" | "unlimited" }>;

export type NewLimitKey = keyof typeof NEW_LIMIT_CATALOG;
export const NEW_LIMIT_KEYS = Object.keys(NEW_LIMIT_CATALOG) as NewLimitKey[];
export type LegacyLimitKey = (typeof LEGACY_LIMIT_KEYS)[number];
export type LimitKey = LegacyLimitKey | NewLimitKey;
export const ALL_LIMIT_KEYS: readonly LimitKey[] = [...LEGACY_LIMIT_KEYS, ...NEW_LIMIT_KEYS];

// ---------------------------------------------------------------------------------------------------------------------------------
// Matriz Free | Starter | Pro (+ Business/courtesy = tudo liberado). UNICO lugar dos valores PLACEHOLDER.
// ---------------------------------------------------------------------------------------------------------------------------------
export type PlanLimitValues = Record<LimitKey, number | null>;
export type PlanFeatureValues = Record<FeatureKey, boolean>;

export interface PlanDefinition {
  name: string;
  priceMonthlyCents: number;
  priceYearlyCents: number | null;
  selfServiceCheckout: boolean;
  limits: PlanLimitValues;
  features: PlanFeatureValues;
}

const allFeatures = (v: boolean): PlanFeatureValues => Object.fromEntries(FEATURE_KEYS.map((k) => [k, v])) as PlanFeatureValues;
const featuresOn = (...on: FeatureKey[]): PlanFeatureValues => ({ ...allFeatures(false), ...Object.fromEntries(on.map((k) => [k, true])) });
const UNLIMITED_LIMITS: PlanLimitValues = Object.fromEntries(ALL_LIMIT_KEYS.map((k) => [k, null])) as PlanLimitValues;

export const PLAN_MATRIX: Record<PlanKey, PlanDefinition> = {
  free: {
    // Trial de 14 dias (SPEC-065). Fora da vitrine, sem checkout.
    name: PLAN_DISPLAY_NAMES.free,
    priceMonthlyCents: 0,
    priceYearlyCents: null,
    selfServiceCheckout: false,
    limits: {
      maxCampaigns: 1, maxWhatsappInstances: 1, maxEmailAccounts: 1, maxLeadsPerMonth: 50, maxSendsPerDay: 20,
      maxActiveAgents: 0, maxAiBudgetCentsMonth: 0, maxAgentMessagesPerDay: 0, maxLeadSearchesPerDay: 2, maxCreativesPerMonth: 0, maxMembers: 1, maxSequenceSteps: 3,
    },
    features: featuresOn("inbox.read"),
  },
  starter: {
    // PLACEHOLDER: confirmar preço final antes do launch (D-33-2).
    name: PLAN_DISPLAY_NAMES.starter,
    priceMonthlyCents: 29_700,
    priceYearlyCents: 297_000, // 2 meses grátis
    selfServiceCheckout: true,
    limits: {
      maxCampaigns: 3, maxWhatsappInstances: 1, maxEmailAccounts: 1, maxLeadsPerMonth: 500, maxSendsPerDay: 300,
      maxActiveAgents: 1, maxAiBudgetCentsMonth: 5_000, maxAgentMessagesPerDay: 20, maxLeadSearchesPerDay: 10, maxCreativesPerMonth: 3, maxMembers: 3, maxSequenceSteps: 5,
    },
    features: featuresOn("agents.role.followup", "agents.autonomy.draft", "inbox.read", "inbox.reply"),
  },
  pro: {
    // PLACEHOLDER: confirmar preço final antes do launch (D-33-2).
    name: PLAN_DISPLAY_NAMES.pro,
    priceMonthlyCents: 69_700,
    priceYearlyCents: 697_000, // 2 meses grátis
    selfServiceCheckout: true,
    limits: {
      maxCampaigns: 10, maxWhatsappInstances: 3, maxEmailAccounts: 3, maxLeadsPerMonth: 3000, maxSendsPerDay: 1000,
      maxActiveAgents: 3, maxAiBudgetCentsMonth: 20_000, maxAgentMessagesPerDay: 100, maxLeadSearchesPerDay: 30, maxCreativesPerMonth: 20, maxMembers: 10, maxSequenceSteps: null,
    },
    features: featuresOn(
      "agents.role.sdr", "agents.role.followup", "agents.role.closer", "agents.autonomy.draft", "agents.autonomy.sample", "agents.autonomy.auto",
      "sources.ads", "ingest.api", "inbox.read", "inbox.reply", "inbox.attachments", "inbox.labels",
    ), // `llm.byok` fica de fora: so por override/Business (Q-069-2)
  },
  business: {
    // PLACEHOLDER: "sob consulta" — sem checkout self-service (D-33-2); preço 0 = não cobrado por aqui.
    name: PLAN_DISPLAY_NAMES.business,
    priceMonthlyCents: 0,
    priceYearlyCents: null,
    selfServiceCheckout: false,
    limits: UNLIMITED_LIMITS,
    features: allFeatures(true),
  },
  courtesy: {
    // SPEC-040: sem cobrança real, acesso sem limite; só o platform_admin atribui (nunca aparece na vitrine).
    name: PLAN_DISPLAY_NAMES.courtesy,
    priceMonthlyCents: 0,
    priceYearlyCents: null,
    selfServiceCheckout: false,
    limits: UNLIMITED_LIMITS,
    features: allFeatures(true),
  },
};

/** Conteudo gravado em `Plan.limits` (JSON): limites numericos + objeto `features` (sem migration, D-069-4). */
export function planLimitsJson(key: PlanKey): Record<string, unknown> {
  const p = PLAN_MATRIX[key];
  return { ...p.limits, features: { ...p.features } };
}

/** Menor plano (Free < Starter < Pro < Business) que libera a funcionalidade segundo a matriz; Business se so ele libera. */
export function requiredPlanForFeature(feature: FeatureKey): PlanKey {
  return PLAN_ORDER.find((k) => PLAN_MATRIX[k].features[feature]) ?? "business";
}
