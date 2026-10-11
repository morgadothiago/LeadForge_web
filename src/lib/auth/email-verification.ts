import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError, safeErrorForLog } from "@/lib/errors";
import { SlidingLimiter } from "@/lib/integrations/rate-limit";
import { sendSystemEmail } from "@/lib/channels/system-mail";
import { absoluteAppUrl, sendOnce } from "@/lib/channels/email/send-once";
import { emailVerificationTemplate } from "@/lib/channels/email/templates/email-verification";
import { welcomeTemplate } from "@/lib/channels/email/templates/welcome";

/**
 * SPEC-055 — verificacao de e-mail (D-055-1/3/6/7/8). Padrao de `password-reset.ts`: token opaco (32 bytes base64url) so
 * existe no link do e-mail; o banco guarda o sha256 (`EmailVerificationToken.tokenHash`). 24h, uso unico.
 * Vive aqui (nao em `actions/*`, arquivos "use server" so exportam funcoes async) para expor limiters/helpers sincronos.
 */
export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
/** D-055-8: intervalo minimo entre dois e-mails de verificacao do mesmo usuario. */
export const VERIFY_RESEND_COOLDOWN_MS = 60_000;

export function newVerificationToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashVerificationToken(token) };
}

export function hashVerificationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const WINDOW_MS = 60 * 60_000;
/** D-055-8: rate limit do reenvio por usuario E por IP (chaves independentes). */
export const resendByUserLimiter = new SlidingLimiter(5, WINDOW_MS);
export const resendByIpLimiter = new SlidingLimiter(20, WINDOW_MS);
/** Testes: zera os limitadores do reenvio. */
export function clearResendRateLimit(): void {
  resendByUserLimiter.clear();
  resendByIpLimiter.clear();
}

export const EMAIL_NOT_VERIFIED_MESSAGE = "Confirme seu e-mail para enviar mensagens. Enviamos um link de confirmação para o seu endereço de cadastro.";

export function emailNotVerifiedError(): AppError {
  return new AppError({ code: "email_not_verified", userMessage: EMAIL_NOT_VERIFIED_MESSAGE });
}

/** `true` se o usuario ja confirmou o e-mail (ou e legado/backfill). Usuario inexistente => false. */
export async function isUserEmailVerified(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true } });
  return u?.emailVerifiedAt != null;
}

/** D-055-7: lanca `email_not_verified` (AppError tipado) se o usuario nao verificou o e-mail. */
export async function assertUserEmailVerified(userId: string): Promise<void> {
  if (!(await isUserEmailVerified(userId))) throw emailNotVerifiedError();
}

/**
 * Gera um token novo e envia o e-mail de verificacao. Tokens anteriores ainda validos continuam validos (o ultimo
 * link clicado vale; todos uso unico). Best-effort: NUNCA lanca (falha do provider nao quebra o fluxo chamador).
 * Retorna `false` se nao conseguiu gravar/enviar.
 */
export async function issueVerificationEmail(user: { id: string; email: string }, now: Date = new Date()): Promise<boolean> {
  try {
    const { token, hash } = newVerificationToken();
    await prisma.emailVerificationToken.create({
      data: { userId: user.id, email: user.email, tokenHash: hash, expiresAt: new Date(now.getTime() + VERIFY_TOKEN_TTL_MS) },
    });
    const { subject, html, text } = emailVerificationTemplate({ link: absoluteAppUrl(`/verificar-email?token=${token}`) });
    const r = await sendSystemEmail(user.email, subject, { html, text }, "email_verification");
    if (!r.ok) {
      console.error("[email-verification] falha ao enviar e-mail:", safeErrorForLog(r.error));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[email-verification] falha:", safeErrorForLog(e));
    return false;
  }
}

/** Boas-vindas (#1): idempotente por `welcome:<userId>`, pos-commit, best-effort (nunca lanca). Sem data de trial (D-055-2). */
export async function sendWelcomeEmail(user: { id: string; name: string; email: string }): Promise<void> {
  try {
    const { subject, html, text } = welcomeTemplate({ name: user.name, link: absoluteAppUrl("/dashboard") });
    await sendOnce({ dedupeKey: `welcome:${user.id}`, scenario: "welcome", to: user.email, subject, html, text, userId: user.id });
  } catch (e) {
    console.error("[welcome] falha:", safeErrorForLog(e));
  }
}

/** Cadastro self-service novo: boas-vindas + e-mail de verificacao, ambos pos-commit e best-effort. */
export async function sendSignupEmails(user: { id: string; name: string; email: string }, opts: { verify: boolean }): Promise<void> {
  await sendWelcomeEmail(user);
  if (opts.verify) await issueVerificationEmail(user);
}
