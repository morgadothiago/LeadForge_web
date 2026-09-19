"use server";

import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { createSession, destroySession } from "@/lib/auth/session";
import { getDummyHash, verifyPassword } from "@/lib/auth/password";
import { getClientIp } from "@/lib/auth/client-ip";
import { emailKey, isRateLimited, loginKey, recordFailure, resetFailures } from "@/lib/auth/rate-limit";
import { safeNext } from "@/lib/auth/safe-redirect";
import { loginSchema, type LoginInput } from "@/lib/schemas/auth";
import { formError, safeAction, success, zodErrors, type ActionResult } from "./result";

const INVALID = "E-mail ou senha inválidos.";

/** Login. Sucesso: cookie de sessão setado e `redirectTo` seguro (o frontend navega). Ação pública (sem requireUser). */
export async function login(input: LoginInput): Promise<ActionResult<{ redirectTo: string }>> {
  return safeAction(async () => {
    const parsed = loginSchema.safeParse(input);
    if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) };
    const { email, password, next } = parsed.data;
    const key = loginKey(email, getClientIp(await headers()));
    const ek = emailKey(email);
    if (isRateLimited(key, ek)) return formError("Muitas tentativas. Aguarde alguns minutos e tente novamente.");

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, passwordHash: true } });
    // Tempo constante: sempre executa um verify (contra hash dummy se não há usuário/senha).
    const ok = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), password);
    if (!user || !user.passwordHash || !ok) {
      recordFailure(key, ek);
      return formError(INVALID);
    }
    resetFailures(key, ek);
    await createSession(user.id);
    return success({ redirectTo: safeNext(next) });
  });
}

/** Logout: remove o cookie. O frontend navega para `redirectTo` ("/login"). Ação pública. */
export async function logout(): Promise<ActionResult<{ redirectTo: string }>> {
  return safeAction(async () => {
    await destroySession();
    return success({ redirectTo: "/login" });
  });
}
