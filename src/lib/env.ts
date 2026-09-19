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
