// APENAS testes: jar de cookies/headers em memória usado pelo mock de next/headers (src/test/setup.ts).
// requireUser() de produção não é alterado: os testes criam sessão real (JWT) via signInAs().
import { AsyncLocalStorage } from "node:async_hooks";
import { SESSION_COOKIE } from "./config";
import { signSessionToken } from "./session-token";

const jar = new Map<string, string>();
/** Jar isolado por "requisição" simulada (permite Promise.all com sessões distintas). Ver `runWithSession`. */
const requestJar = new AsyncLocalStorage<Map<string, string>>();
const activeJar = () => requestJar.getStore() ?? jar;

export const testCookies = {
  get: (name: string) => (activeJar().has(name) ? { name, value: activeJar().get(name)! } : undefined),
  set: (name: string, value: string) => void activeJar().set(name, value),
  delete: (name: string) => void activeJar().delete(name),
};

/** APENAS testes: executa `fn` com uma sessão própria (JWT real) isolada do jar global — simula requisições concorrentes de usuários distintos. */
export async function runWithSession<T>(userId: string, orgId: string, fn: () => Promise<T>): Promise<T> {
  const token = await signSessionToken(userId, orgId, "provider");
  return requestJar.run(new Map([[SESSION_COOKIE, token]]), fn);
}

export const testHeaders: { current: Headers } = { current: new Headers() };

/**
 * Inicia sessão real (cookie JWT assinado) para o usuário. SPEC-030: resolve orgId/platformRole do
 * banco (mesma lógica do login de produção) — `orgId`/`platformRole` explícitos pulam a resolução
 * (útil para testar platform_admin ou um orgId específico sem depender de Membership real).
 */
export async function signInAs(userId: string, opts: { orgId?: string | null; platformRole?: "provider" | "platform_admin" } = {}): Promise<void> {
  let { orgId, platformRole } = opts;
  if (orgId === undefined || platformRole === undefined) {
    const { prisma } = await import("@/lib/prisma");
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true, memberships: { select: { orgId: true }, take: 1 } } });
    platformRole ??= u.role === "platform_admin" ? "platform_admin" : "provider";
    orgId ??= u.memberships[0]?.orgId ?? null;
  }
  jar.set(SESSION_COOKIE, await signSessionToken(userId, orgId, platformRole));
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
