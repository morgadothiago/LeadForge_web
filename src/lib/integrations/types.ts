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
/** Integrações com cliente real para "Testar conexão" (as demais: teste indisponível). */
export const TESTABLE: Record<IntegrationKindName, boolean> = { evolution: true, n8n: false, llm: false, places: false };
