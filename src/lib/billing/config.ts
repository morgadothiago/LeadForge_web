/**
 * Configuração da autenticação do webhook de billing em modo mock (SPEC-033, QA fix — achado crítico).
 *
 * Em modo `stripe`, a rota `POST /api/billing/webhook` é autenticada pela assinatura HMAC real
 * (`provider.verifyWebhookSignature`, header `stripe-signature`). Em modo `mock` (default do projeto),
 * `MockPaymentProvider.verifyWebhookSignature` sempre retorna `true` (não há gateway externo a validar) —
 * então, sem uma camada adicional, qualquer chamador HTTP não autenticado poderia forjar um evento
 * (`orgId` cru do payload) e ativar/suspender a assinatura de qualquer organização.
 *
 * Correção: quando o provider ativo é `mock`, a rota HTTP exige também `Authorization: Bearer
 * <MOCK_WEBHOOK_SECRET>` (mesmo padrão de `CRON_SECRET`/`INGEST_SECRET`: segredo de 32+ chars, comparação
 * em tempo constante via `secretsMatch`, ausente/curto => rota responde 503, nunca fica aberta). O
 * caminho INTERNO (`MockPaymentProvider.createCheckoutSession` chamando `processBillingEvent` direto,
 * sem HTTP) não passa por aqui e continua funcionando sem esse segredo.
 */
export const MIN_MOCK_WEBHOOK_SECRET_LENGTH = 32;

type Env = Record<string, string | undefined>;

/** null = ausente ou curto demais (a rota responde 503 com PAYMENT_PROVIDER=mock; nunca fica aberta). */
export function getMockWebhookSecret(env: Env = process.env): string | null {
  const s = env.MOCK_WEBHOOK_SECRET;
  return s && s.length >= MIN_MOCK_WEBHOOK_SECRET_LENGTH ? s : null;
}
