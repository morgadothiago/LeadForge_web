"use server";

import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { createSession, destroySession } from "@/lib/auth/session";
import { getDummyHash, hashPassword, verifyPassword } from "@/lib/auth/password";
import { getClientIp } from "@/lib/auth/client-ip";
import { emailKey, isRateLimited, loginKey, recordFailure, resetFailures } from "@/lib/auth/rate-limit";
import { newResetToken, hashResetToken, RESET_TOKEN_TTL_MS, forgotByEmailLimiter, forgotByIpLimiter } from "@/lib/auth/password-reset";
import { safeNext } from "@/lib/auth/safe-redirect";
import { homeRouteFor } from "@/lib/auth/require-user";
import { loginSchema, forgotPasswordSchema, resetPasswordSchema, type LoginInput } from "@/lib/schemas/auth";
import { sendSystemEmail } from "@/lib/channels/system-mail";
import { passwordResetTemplate } from "@/lib/channels/email/templates/password-reset";
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
    const key = loginKey(email, getClientIp(await headers()));
    const ek = emailKey(email);
    if (isRateLimited(key, ek)) return formError("Muitas tentativas. Aguarde alguns minutos e tente novamente.");

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, role: true, memberships: { select: { orgId: true }, take: 1 } },
    });
    // Tempo constante: sempre executa um verify (contra hash dummy se não há usuário/senha).
    const ok = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), password);
    if (!user || !user.passwordHash || !ok) {
      recordFailure(key, ek);
      return formError(INVALID);
    }
    // SPEC-030: platform_admin nunca tem Membership (D-30-1); provider sem Membership é estado inconsistente (nunca deveria existir pós-migração) -> erro tratado, nunca sessão sem org.
    const platformRole = user.role === "platform_admin" ? "platform_admin" : "provider";
    const orgId = user.memberships[0]?.orgId ?? null;
    if (platformRole === "provider" && !orgId) {
      recordFailure(key, ek);
      return formError("Conta sem organização associada. Contate o suporte.");
    }
    resetFailures(key, ek);
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
    const ip = getClientIp(await headers());

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

    try {
      await prisma.$transaction(async (tx) => {
        const claim = await tx.passwordResetToken.updateMany({
          where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
          data: { usedAt: now },
        });
        if (claim.count === 0) throw new TokenInvalidError();
        const record = await tx.passwordResetToken.findUniqueOrThrow({ where: { tokenHash }, select: { userId: true } });
        await tx.user.update({ where: { id: record.userId }, data: { passwordHash, sessionsInvalidatedAt: now } });
      });
    } catch (e) {
      if (e instanceof TokenInvalidError) return formError(RESET_INVALID_MESSAGE);
      throw e;
    }
    return success({ redirectTo: "/login" });
  });
}
