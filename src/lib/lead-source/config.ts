/**
 * Configuração dos webhooks de captação SPEC-041 (Google Ads Lead Form + Meta Lead Ads). Cada plataforma
 * é DESLIGADA por padrão (503) até a flag exata "true" ser setada — mesmo cuidado de `lead-ingest/config.ts`
 * (SPEC-014): nova superfície pública nunca fica aberta por omissão.
 */
export const MAX_BODY_BYTES = 1024 * 1024;
export const MIN_META_VERIFY_TOKEN_LENGTH = 16;
export const MIN_META_APP_SECRET_LENGTH = 16;

type Env = Record<string, string | undefined>;

export function isGoogleAdsLeadsEnabled(env: Env = process.env): boolean {
  return env.INTEGRATION_LEADS_GOOGLE_ADS_ENABLED === "true";
}

export function isMetaLeadsEnabled(env: Env = process.env): boolean {
  return env.INTEGRATION_LEADS_META_ENABLED === "true";
}

/**
 * App Secret do App do Facebook usado para assinar (`X-Hub-Signature-256`) TODAS as notificações de
 * webhook `leadgen`, independente de qual org/página originou o lead — decorre de como a assinatura de
 * webhook da Graph API funciona (1 App = 1 assinatura de webhook para todas as Páginas inscritas nele).
 * A resolução de QUAL org/campanha recebe o lead nunca usa este valor: é sempre `LeadSourceBinding`
 * (D-041-3), a partir do `page_id` do payload. O Page Access Token (por org/página) é o segredo
 * escopado por org, guardado em `IntegrationSecret` (D-041-4).
 */
export function getMetaAppSecret(env: Env = process.env): string | null {
  const s = env.META_APP_SECRET?.trim();
  return s && s.length >= MIN_META_APP_SECRET_LENGTH ? s : null;
}

/** Token usado só na etapa única de handshake (`GET`) de inscrição do webhook na Graph API. */
export function getMetaWebhookVerifyToken(env: Env = process.env): string | null {
  const s = env.META_WEBHOOK_VERIFY_TOKEN?.trim();
  return s && s.length >= MIN_META_VERIFY_TOKEN_LENGTH ? s : null;
}
