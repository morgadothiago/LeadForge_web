import type { FeatureKey } from "@/lib/billing/plan-catalog";

export const INTEGRATIONS = ["evolution", "n8n", "llm", "places"] as const;
export type IntegrationKindName = (typeof INTEGRATIONS)[number];
export type IntegrationOrigin = "db" | "env" | "none";

export const INTEGRATION_LABEL: Record<IntegrationKindName, string> = {
  evolution: "WhatsApp (Evolution API)",
  n8n: "n8n",
  llm: "Provedor de LLM",
  places: "Busca de leads (Places)",
};

/** Integrações que exigem endereço (URL) e por isso passam pela checagem SSRF. */
export const REQUIRES_BASE_URL: Record<IntegrationKindName, boolean> = { evolution: true, n8n: true, llm: false, places: false };
/** Integrações com cliente real para "Testar conexão" (as demais: teste indisponível). `llm`: só com URL base (OpenAI-compatível, SPEC-036); Claude sem URL => indisponível. `llm` não exige URL (REQUIRES_BASE_URL false), mas com URL o url-guard roda. */
export const TESTABLE: Record<IntegrationKindName, boolean> = { evolution: true, n8n: false, llm: true, places: false };

/**
 * SPEC-069b: integracao que o PLANO libera (`assertFeature` em save/test). `llm` = BYOK (desligado por padrao: a IA e da plataforma, D-069-7);
 * `n8n` = ingestao externa por API (Pro). `evolution`/`places`: sem feature por plano (chave da plataforma/pareamento; politica do admin = 069c).
 */
export const INTEGRATION_FEATURE: Partial<Record<IntegrationKindName, FeatureKey>> = { llm: "llm.byok", n8n: "ingest.api" };
