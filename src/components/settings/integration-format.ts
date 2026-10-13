import type { IntegrationKind } from "@prisma/client";
import type { IntegrationKindName, IntegrationOrigin } from "@/lib/integrations/types";
import type { FeatureKey } from "@/lib/billing/plan-catalog";

export const ORIGIN_LABEL: Record<IntegrationOrigin, string> = {
  db: "Salva no painel",
  env: "Usando valor do ambiente (.env) — salvar aqui passa a ter prioridade",
  none: "Não configurada",
};

export const originLabel = (o: IntegrationOrigin): string => ORIGIN_LABEL[o];
export const statusLabel = (configured: boolean): "Configurada" | "Não configurada" => (configured ? "Configurada" : "Não configurada");

/** Máscara do hint (últimos 4 caracteres). Nunca recebe/mostra o valor. */
export function maskHint(hint: string | null | undefined): string {
  const h = (hint ?? "").replace(/[^\p{L}\p{N}]/gu, "").slice(-4);
  return h ? `••••${h}` : "••••";
}

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  create: "Criou",
  rotate: "Girou a chave",
  delete: "Removeu",
  test: "Testou a conexão",
  update_url: "Alterou a URL",
};
export const auditActionLabel = (a: string): string => AUDIT_ACTION_LABEL[a] ?? a;

/** Todos os `IntegrationKind` do schema — a auditoria é por-kind (SPEC-041 acrescenta google_ads_leads/meta_leads). */
export const INTEGRATION_SHORT_LABEL: Record<IntegrationKind, string> = {
  evolution: "Evolution API",
  n8n: "n8n",
  llm: "Provedor de IA/LLM",
  places: "Busca de leads (Places)",
  google_ads_leads: "Google Ads (Lead Form)",
  meta_leads: "Meta Lead Ads",
};

export interface AuditRowInput {
  integration: IntegrationKind;
  action: string;
  userName: string | null;
  hostMasked: string | null;
  allowPrivateHost: boolean | null;
}
export function formatAuditRow(e: AuditRowInput): { integration: string; action: string; user: string; host: string } {
  return {
    integration: INTEGRATION_SHORT_LABEL[e.integration] ?? e.integration,
    action: auditActionLabel(e.action),
    user: e.userName?.trim() || "Usuário removido",
    host: e.hostMasked ? `${e.hostMasked}${e.allowPrivateHost ? " (instância própria)" : ""}` : "—",
  };
}

/** Validação local básica de URL base (o backend é a fonte da verdade). Retorna mensagem ou undefined. */
export function validateBaseUrl(raw: string, required: boolean): string | undefined {
  const v = raw.trim();
  if (!v) return required ? "Informe a URL." : undefined;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return "URL inválida. Ex.: https://evolution.exemplo.com";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "Use uma URL http:// ou https://.";
  if (u.username || u.password) return "A URL não pode conter usuário/senha.";
  if (v.includes("#") || v.includes("?")) return "A URL não pode conter '?' nem '#'.";
  return undefined;
}

/** Interpreta a mensagem de rate limit do backend. */
export const isRateLimitMessage = (m: string): boolean => /muitos testes/i.test(m);

/**
 * SPEC-069d — o que o TENANT pode fazer em cada integracao (so UX; o servidor recusa de qualquer jeito):
 * - `platform`: a chave/servidor e da PLATAFORMA (Evolution, Places, LLM sem BYOK, ou qualquer chave gravada pelo admin): somente leitura.
 * - `locked`: o plano nao libera (n8n sem `ingest.api`): explicacao + upgrade.
 * - `editable`: o cliente cadastra a propria chave (n8n no Pro; LLM so com BYOK liberado).
 */
export type IntegrationAccess =
  | { mode: "editable" }
  | { mode: "platform"; note: string }
  | { mode: "locked"; feature: FeatureKey };

export function integrationAccess(kind: IntegrationKindName, features: Partial<Record<FeatureKey, boolean>>, item?: { managedByPlatform: boolean } | null): IntegrationAccess {
  if (kind === "evolution") return { mode: "platform", note: "O servidor do WhatsApp é gerenciado pela plataforma. Você só conecta o seu número (QR code) em Configurações > WhatsApp." };
  if (kind === "places") return { mode: "platform", note: "A chave da busca de leads é gerenciada pela plataforma. Você só usa a busca, dentro do limite do seu plano." };
  if (item?.managedByPlatform) return { mode: "platform", note: "Esta chave é gerenciada pela plataforma; você não precisa (nem pode) editá-la." };
  if (kind === "llm") return features["llm.byok"] === true ? { mode: "editable" } : { mode: "platform", note: "A IA dos agentes é fornecida e paga pela plataforma. Você não precisa configurar chave nem provedor." };
  if (kind === "n8n") return features["ingest.api"] === true ? { mode: "editable" } : { mode: "locked", feature: "ingest.api" };
  return { mode: "editable" };
}
