import { requireUser, type CurrentUser } from "./require-user";

export class ForbiddenError extends Error {
  constructor() {
    super("Sem permissão.");
    this.name = "ForbiddenError";
  }
}

/**
 * SPEC-030: exige sessão de `provider` com org ativa. Substitui o antigo `requireAdmin()` para todo
 * recurso que hoje é por-organização (campanhas, integrações, agentes, configurações...). Lança
 * UnauthorizedError (sem sessão) ou ForbiddenError (sessão de platform_admin, sem org).
 */
export async function requireProviderOrg(): Promise<{ user: CurrentUser; orgId: string }> {
  const user = await requireUser();
  if (user.platformRole !== "provider" || !user.orgId) throw new ForbiddenError();
  return { user, orgId: user.orgId };
}

/**
 * SPEC-030: exige sessão de `platform_admin` (cross-tenant, sem org). Usado pelas SPECs 031-034 (admin
 * cross-tenant) — nenhum endpoint desta SPEC-030 chama isto ainda (fora de escopo, ver spec.md).
 */
export async function requirePlatformAdmin(): Promise<{ user: CurrentUser }> {
  const user = await requireUser();
  if (user.platformRole !== "platform_admin") throw new ForbiddenError();
  return { user };
}
