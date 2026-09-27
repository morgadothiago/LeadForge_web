import { z } from "zod";

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  EVOLUTION_API_URL: z.string().url().optional(),
  EVOLUTION_API_KEY: z.string().min(1).optional(),
  /** REMOVIDO/DEPRECIADO (SPEC-011/012, D17): o segredo é o `webhookToken` por instância, no caminho da URL. Não é lido; mantido só para não quebrar .env antigos. */
  EVOLUTION_WEBHOOK_SECRET: z.string().min(1).optional(),
  APP_BASE_URL: z.string().url().optional(),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET deve ter ao menos 32 caracteres."),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(12, "ADMIN_PASSWORD deve ter ao menos 12 caracteres.").optional(),
  AUTH_URL: z.string().url().optional(),
  ENCRYPTION_KEY: z.string().min(1).optional(),
  /** SPEC-017: palavras promocionais (vírgulas) usadas no validador do 1º toque de WhatsApp. Default: lista embutida. */
  WHATSAPP_PROMO_WORDS: z.string().optional(),
  /** SPEC-013: segredo do /api/cron/tick (32+ chars). Ausente/curto => endpoint 503. Validado em runtime (scheduler/config), não aqui, para não derrubar o app. */
  CRON_SECRET: z.string().optional(),
  SCHEDULER_TIME_BUDGET_MS: z.string().optional(),
  SCHEDULER_MAX_SENDS: z.string().optional(),
  /** SPEC-033 (D-33-5): "mock" (default) ou "stripe". Stripe real exige STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET (sem conta ainda). */
  PAYMENT_PROVIDER: z.enum(["mock", "stripe"]).optional(),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  /** SPEC-033 QA fix (achado crítico): segredo compartilhado (32+ chars) que autentica POST /api/billing/webhook quando PAYMENT_PROVIDER=mock (Bearer). Ausente => rota responde 503 (nunca aceita evento não autenticado). Validado em runtime (billing/config), não aqui, para não derrubar o app. */
  MOCK_WEBHOOK_SECRET: z.string().optional(),
  /** SPEC-041: flags "true" para ligar cada webhook de captação de leads (desligados por padrão). */
  INTEGRATION_LEADS_GOOGLE_ADS_ENABLED: z.string().optional(),
  INTEGRATION_LEADS_META_ENABLED: z.string().optional(),
  /** SPEC-041: App Secret do App do Facebook (assina TODAS as notificações `leadgen` da Graph API; não identifica org/campanha — ver lead-source/config.ts). Validado em runtime, não aqui. */
  META_APP_SECRET: z.string().optional(),
  /** SPEC-041: token do handshake de inscrição (`GET`) do webhook `leadgen` na Graph API. Validado em runtime, não aqui. */
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  /** SPEC-046: opcional — ausente = e-mail transacional usa só o SMTP acima (fallback automático, D-046-2). */
  RESEND_API_KEY: z.string().min(1).optional(),
  /** SPEC-046 (D-046-1): remetente por cenário (todos opcionais, com fallback em cascata — ver `channels/email/scenario.ts`). */
  RESEND_FROM_NOREPLY: z.string().min(1).optional(),
  RESEND_FROM_SUPPORT: z.string().min(1).optional(),
  RESEND_FROM_BILLING: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  return envSchema.parse(source);
}

let cached: Env | undefined;
export function getEnv(): Env {
  return (cached ??= parseEnv(process.env));
}

/**
 * ENCRYPTION_KEY (32 bytes em base64) — exigida só quando se usa e-mail (cifra da senha SMTP, assinatura do descadastro).
 * Lê process.env a cada chamada (sem cache) e falha com erro claro se ausente/inválida. Gerar: `openssl rand -base64 32`.
 */
export function getEncryptionKey(source: Record<string, string | undefined> = process.env): Buffer {
  const raw = source.ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error("ENCRYPTION_KEY não configurada. Gere com: openssl rand -base64 32");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY inválida: deve ter 32 bytes em base64 (openssl rand -base64 32).");
  return key;
}
