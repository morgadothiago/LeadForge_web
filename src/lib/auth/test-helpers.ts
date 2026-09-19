// APENAS testes: jar de cookies/headers em memória usado pelo mock de next/headers (src/test/setup.ts).
// requireUser() de produção não é alterado: os testes criam sessão real (JWT) via signInAs().
import { SESSION_COOKIE } from "./config";
import { signSessionToken } from "./session-token";

const jar = new Map<string, string>();

export const testCookies = {
  get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  set: (name: string, value: string) => void jar.set(name, value),
  delete: (name: string) => void jar.delete(name),
};

export const testHeaders: { current: Headers } = { current: new Headers() };

/** Inicia sessão real (cookie JWT assinado) para o usuário. */
export async function signInAs(userId: string): Promise<void> {
  jar.set(SESSION_COOKIE, await signSessionToken(userId));
}
export function signOut(): void {
  jar.clear();
}
export function getCookie(name: string): string | undefined {
  return jar.get(name);
}
export function setCookie(name: string, value: string): void {
  jar.set(name, value);
}

/** Sessão como o admin do seed (admin@leadforge.local). Chamar após seed(prisma). */
export async function signInAsSeedAdmin(): Promise<void> {
  const { prisma } = await import("@/lib/prisma");
  const u = await prisma.user.findUniqueOrThrow({ where: { email: "admin@leadforge.local" }, select: { id: true } });
  await signInAs(u.id);
}
