import { createHash, randomBytes } from "node:crypto";
import { SlidingLimiter } from "@/lib/integrations/rate-limit";

/**
 * SPEC-038 (D-038-1): token de "esqueci minha senha" — 24 horas (decisão explícita do usuário, não o
 * padrão de mercado de 30-60min). Mesmo padrão de `src/lib/mobile/token.ts` (refresh token mobile):
 * valor opaco aleatório (32 bytes, base64url) só existe em claro no link do e-mail; o banco grava
 * somente o sha256 (`PasswordResetToken.tokenHash`), nunca o valor em claro.
 */
export const RESET_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export function newResetToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashResetToken(token) };
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// SPEC-038: rate limit de `forgotPassword` por e-mail E por IP (mesmo padrão de outros fluxos públicos,
// ex. `signupLimiter` de `billing.ts`/D-33-1). Duas chaves independentes: rotacionar IP não escapa do
// limite por e-mail; pulverizar e-mails de um mesmo IP não escapa do limite por IP. Vive aqui (não em
// `actions/auth.ts`, arquivo "use server" cujos exports devem ser todos async) para poder expor um
// helper de limpeza síncrono para os testes.
const FORGOT_WINDOW_MS = 60 * 60_000;
export const forgotByEmailLimiter = new SlidingLimiter(5, FORGOT_WINDOW_MS);
export const forgotByIpLimiter = new SlidingLimiter(20, FORGOT_WINDOW_MS);

/** Testes: zera os limitadores de `forgotPassword` (mesmo espírito de `_clearRateLimit` em rate-limit.ts). */
export function clearForgotPasswordRateLimit(): void {
  forgotByEmailLimiter.clear();
  forgotByIpLimiter.clear();
}
