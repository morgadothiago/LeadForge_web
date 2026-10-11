"use server";

import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { createSession, destroySession } from "@/lib/auth/session";
import { getDummyHash, hashPassword, verifyPassword } from "@/lib/auth/password";
import { getClientIpKey } from "@/lib/auth/client-ip";
import { emailKey, isRateLimited, loginKey, recordFailure, resetFailures } from "@/lib/auth/rate-limit";
import { newResetToken, hashResetToken, RESET_TOKEN_TTL_MS, forgotByEmailLimiter, forgotByIpLimiter } from "@/lib/auth/password-reset";
import { getPendingDeletion } from "@/lib/account-deletion/service";
import { safeNext } from "@/lib/auth/safe-redirect";
import { homeRouteFor } from "@/lib/auth/require-user";
import { loginSchema, forgotPasswordSchema, resetPasswordSchema, type LoginInput } from "@/lib/schemas/auth";
import { sendSystemEmail } from "@/lib/channels/system-mail";
import { passwordResetTemplate } from "@/lib/channels/email/templates/password-reset";
import { passwordChangedTemplate } from "@/lib/channels/email/templates/password-changed";
import { absoluteAppUrl, sendOnce } from "@/lib/channels/email/send-once";
import {
  hashVerificationToken,
  issueVerificationEmail,
  resendByIpLimiter,
  resendByUserLimiter,
  VERIFY_RESEND_COOLDOWN_MS,
} from "@/lib/auth/email-verification";
import { requireUser } from "@/lib/auth/require-user";
import { safeErrorForLog } from "@/lib/errors";
import { failure, formError, safeAction, success, zodErrors, type ActionResult } from "./result";

const INVALID = "E-mail ou senha inválidos.";

/**
 * SPEC-038: mensagem SEMPRE genérica de `forgotPassword` — nunca revela se o e-mail existe ou não no
 * sistema (mesmo cuidado anti-enumeration de `signUpAndStartCheckout`, SPEC-033/034). O rate limit
 * (abaixo) é verificado ANTES de qualquer consulta ao usuário, então "muitas tentativas" também não
 * revela nada (é checado igual para e-mail existente ou não).
 */
const FORGOT_GENERIC_MESSAGE = "Se este e-mail estiver cadastrado, enviaremos um link para redefinir a senha. Verifique também a caixa de spam.";
const RESET_INVALID_MESSAGE = "Link de redefinição inválido ou expirado. Solicite um novo link.";

const baseUrl = (): string => (process.env.APP_BASE_URL || process.env.AUTH_URL || "http://localhost:3000").replace(/\/+$/, "");

class TokenInvalidError extends Error {}

/** Login. Sucesso: cookie de sessão setado e `redirectTo` seguro (o frontend navega). Ação pública (sem requireUser). */
export async function login(input: LoginInput): Promise<ActionResult<{ redirectTo: string }>> {
  return safeAction(async () => {
    const parsed = loginSchema.safeParse(input);
    if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) };
    const { email, password, next } = parsed.data;
    const key = loginKey(email, getClientIpKey(await headers()));
    const ek = emailKey(email);
    if (isRateLimited(key, ek)) return formError("Muitas tentativas. Aguarde alguns minutos e tente novamente.");

    const user = await prisma.user.findUnique({
      where: { email },
      // SPEC-049 (D-049-4): todas as orgs (ordem de entrada) — o login abre `lastOrgId` se ainda for membro, senão a primeira.
      select: { id: true, passwordHash: true, role: true, lastOrgId: true, memberships: { select: { orgId: true }, orderBy: { createdAt: "asc" } } },
    });
    // Tempo constante: sempre executa um verify (contra hash dummy se não há usuário/senha).
    const ok = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), password);
    if (!user || !user.passwordHash || !ok) {
      recordFailure(key, ek);
      return formError(INVALID);
    }
    // SPEC-054a (D-054-2): exclusao de conta confirmada e ainda na janela de 30 dias => conta bloqueada (sem sessao). So depois de
    // validar a senha (nao revela estado a quem nao a conhece). O frontend oferece "Cancelar exclusao" (`cancelAccountDeletionWithPassword`).
    const pending = await getPendingDeletion(user.id);
    if (pending) {
      resetFailures(key, ek);
      return {
        ok: false,
        errors: {
          _form: [`A exclusão desta conta está agendada para ${pending.scheduledFor.toLocaleDateString("pt-BR", { timeZone: "UTC" })}. Cancele a exclusão para voltar a usar a conta.`],
          code: ["account_deletion_pending"],
          scheduledFor: [pending.scheduledFor.toISOString()],
        },
      };
    }
    // SPEC-030: platform_admin nunca tem Membership (D-30-1); provider sem Membership é estado inconsistente (nunca deveria existir pós-migração) -> erro tratado, nunca sessão sem org.
    const platformRole = user.role === "platform_admin" ? "platform_admin" : "provider";
    const orgId = user.memberships.find((m) => m.orgId === user.lastOrgId)?.orgId ?? user.memberships[0]?.orgId ?? null;
    if (platformRole === "provider" && !orgId) {
      recordFailure(key, ek);
      return formError("Conta sem organização associada. Contate o suporte.");
    }
    resetFailures(key, ek);
    if (orgId && orgId !== user.lastOrgId) await prisma.user.update({ where: { id: user.id }, data: { lastOrgId: orgId } });
    await createSession(user.id, orgId, platformRole);
    return success({ redirectTo: safeNext(next, homeRouteFor(platformRole)) });
  });
}

/** Logout: remove o cookie. O frontend navega para `redirectTo` ("/login"). Ação pública. */
export async function logout(): Promise<ActionResult<{ redirectTo: string }>> {
  return safeAction(async () => {
    await destroySession();
    return success({ redirectTo: "/login" });
  });
}

/**
 * SPEC-038 — "Esqueci minha senha". Ação PÚBLICA (sem sessão prévia, como `login`). Resposta SEMPRE
 * genérica ({@link FORGOT_GENERIC_MESSAGE}), mesmo para e-mail inexistente, senha ausente (SSO/sem
 * `passwordHash`) ou rate limit — nunca revela se a conta existe. Gera um token opaco (32 bytes), grava
 * só o `sha256` (`PasswordResetToken.tokenHash`) e envia o link `/redefinir-senha?token=...` por e-mail
 * (infra SPEC-010, reaproveitada em `src/lib/channels/system-mail.ts`). O envio do e-mail NÃO é
 * aguardado (best-effort, "fire and forget") — isso evita que o tempo de resposta desta action varie
 * entre "e-mail existe" (round-trip SMTP) e "e-mail não existe" (nenhum envio), o que seria um canal
 * de enumeração por timing.
 */
export async function forgotPassword(input: unknown): Promise<ActionResult<{ message: string }>> {
  return safeAction(async () => {
    const parsed = forgotPasswordSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { email } = parsed.data;
    const ip = getClientIpKey(await headers());

    if (forgotByEmailLimiter.hit(`email:${email}`) > 0 || forgotByIpLimiter.hit(`ip:${ip}`) > 0) {
      return formError("Muitas tentativas. Aguarde alguns minutos e tente novamente.");
    }

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (user) {
      const { token, hash } = newResetToken();
      await prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hash, expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
      });
      const link = `${baseUrl()}/redefinir-senha?token=${token}`;
      const { subject, html, text } = passwordResetTemplate({ link });
      void sendSystemEmail(email, subject, { html, text }, "password_reset").then((r) => {
        if (!r.ok) console.error("[forgotPassword] falha ao enviar e-mail:", safeErrorForLog(r.error));
      });
    }
    return success({ message: FORGOT_GENERIC_MESSAGE });
  });
}

/**
 * SPEC-038 — "Redefinir senha". Ação PÚBLICA (o usuário ainda não está autenticado; a prova de posse é
 * o token do link). Valida o token (existe, não expirado — 24h, D-038-1 —, não usado ainda) e a nova
 * senha (mesma régua Zod/argon2 do signup, SPEC-034). Marca o token como usado e a senha como
 * atualizada ATOMICAMENTE (transação): `updateMany` com `usedAt: null` como condição evita corrida de
 * dois usos concorrentes do mesmo token (TOCTOU). D-038-2: grava `User.sessionsInvalidatedAt = now()`,
 * o que faz `requireUser()` rejeitar qualquer sessão (JWT) emitida antes disso — encerra todas as
 * sessões ativas do usuário (web). Erro sempre genérico, sem distinguir "não existe" de "expirado" de
 * "já usado" (não vaza detalhe de segurança).
 */
export async function resetPassword(input: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  return safeAction(async () => {
    const parsed = resetPasswordSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { token, password } = parsed.data;
    const tokenHash = hashResetToken(token);
    const now = new Date();
    const passwordHash = await hashPassword(password);

    let changed: { tokenId: string; userId: string; email: string } | null = null;
    try {
      changed = await prisma.$transaction(async (tx) => {
        const claim = await tx.passwordResetToken.updateMany({
          where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
          data: { usedAt: now },
        });
        if (claim.count === 0) throw new TokenInvalidError();
        const record = await tx.passwordResetToken.findUniqueOrThrow({ where: { tokenHash }, select: { id: true, userId: true } });
        const u = await tx.user.update({ where: { id: record.userId }, data: { passwordHash, sessionsInvalidatedAt: now }, select: { email: true } });
        return { tokenId: record.id, userId: record.userId, email: u.email };
      });
    } catch (e) {
      if (e instanceof TokenInvalidError) return formError(RESET_INVALID_MESSAGE);
      throw e;
    }
    // SPEC-055 (#15): aviso "senha alterada" ao PROPRIO e-mail, pos-commit, best-effort (falha do provider nao quebra o reset).
    // Idempotente por token de reset. Sem dado sensivel nem link de acesso direto.
    if (changed) {
      const { subject, html, text } = passwordChangedTemplate({ changedAt: now, resetLink: absoluteAppUrl("/esqueci-senha") });
      await sendOnce({ dedupeKey: `password_changed:${changed.tokenId}`, scenario: "password_changed", to: changed.email, subject, html, text, userId: changed.userId });
    }
    return success({ redirectTo: "/login" });
  });
}

const VERIFY_INVALID_MESSAGE = "Link de confirmação inválido ou expirado. Solicite um novo link.";

/**
 * SPEC-055 — confirma o e-mail pelo token do link. Ação PÚBLICA (o link pode ser aberto em outro navegador/dispositivo;
 * a prova de posse é o token). Uso único e atômico (`updateMany` com `usedAt: null`), expira em 24h, só hash no banco.
 * O token só verifica se o e-mail do token ainda é o e-mail atual do usuário. Erro sempre genérico (não distingue
 * inexistente/expirado/usado). Idempotente para quem já está verificado (consome o token, sem erro).
 */
export async function verifyEmail(input: unknown): Promise<ActionResult<{ verified: true }>> {
  return safeAction(async () => {
    const token = typeof input === "string" ? input : (input as { token?: unknown } | null)?.token;
    if (typeof token !== "string" || token.length < 16 || token.length > 256) return formError(VERIFY_INVALID_MESSAGE);
    const tokenHash = hashVerificationToken(token);
    const now = new Date();
    try {
      await prisma.$transaction(async (tx) => {
        const claim = await tx.emailVerificationToken.updateMany({ where: { tokenHash, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
        if (claim.count === 0) throw new TokenInvalidError();
        const rec = await tx.emailVerificationToken.findUniqueOrThrow({ where: { tokenHash }, select: { userId: true, email: true } });
        const u = await tx.user.findUnique({ where: { id: rec.userId }, select: { email: true, emailVerifiedAt: true } });
        if (!u || u.email.toLowerCase() !== rec.email.toLowerCase()) throw new TokenInvalidError();
        if (!u.emailVerifiedAt) await tx.user.update({ where: { id: rec.userId }, data: { emailVerifiedAt: now } });
      });
    } catch (e) {
      if (e instanceof TokenInvalidError) return formError(VERIFY_INVALID_MESSAGE);
      throw e;
    }
    return success({ verified: true as const });
  });
}

/**
 * SPEC-055 (D-055-8) — reenvia o e-mail de confirmação do usuário LOGADO. Cooldown de 60s (por usuário, via último token) e rate
 * limit por usuário e por IP. Já verificado => `alreadyVerified: true` sem enviar nada. Cooldown/limite => `_form` + `code`
 * ("cooldown" | "rate_limited") e `retryAfterSeconds`, para o front exibir o contador.
 */
export async function resendVerificationEmail(): Promise<ActionResult<{ sent: boolean; alreadyVerified: boolean }>> {
  return safeAction(async () => {
    const user = await requireUser();
    const ip = getClientIpKey(await headers());
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { email: true, emailVerifiedAt: true } });
    if (row.emailVerifiedAt) return success({ sent: false, alreadyVerified: true });

    const last = await prisma.emailVerificationToken.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    if (last) {
      const wait = Math.ceil((last.createdAt.getTime() + VERIFY_RESEND_COOLDOWN_MS - Date.now()) / 1000);
      if (wait > 0) {
        return { ok: false, errors: { _form: [`Aguarde ${wait}s para reenviar o e-mail de confirmação.`], code: ["cooldown"], retryAfterSeconds: [String(wait)] } };
      }
    }
    const limited = Math.max(resendByUserLimiter.hit(`user:${user.id}`), resendByIpLimiter.hit(`ip:${ip}`));
    if (limited > 0) {
      return { ok: false, errors: { _form: ["Muitas tentativas. Aguarde antes de pedir um novo e-mail."], code: ["rate_limited"], retryAfterSeconds: [String(limited)] } };
    }
    const ok = await issueVerificationEmail({ id: user.id, email: row.email });
    if (!ok) return formError("Não foi possível enviar o e-mail agora. Tente novamente em instantes.");
    return success({ sent: true, alreadyVerified: false });
  });
}
