import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from "./config";
import { signSessionToken, verifySessionToken, type PlatformRole, type SessionPayload } from "./session-token";

/** Cria a sessão: cookie httpOnly, sameSite=lax, secure em produção, path=/, 7 dias. `orgId` null só para platform_admin (D-30-1). */
export async function createSession(userId: string, orgId: string | null, platformRole: PlatformRole): Promise<void> {
  const token = await signSessionToken(userId, orgId, platformRole);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Lê e valida (assinatura/expiração) a sessão do cookie. Não consulta o banco. */
export async function getSession(): Promise<SessionPayload | null> {
  return verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
}
