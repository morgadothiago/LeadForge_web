import { prisma } from "@/lib/prisma";
import { requireUser, type CurrentUser } from "./require-user";

export class ForbiddenError extends Error {
  constructor() {
    super("Sem permissão.");
    this.name = "ForbiddenError";
  }
}

/** SPEC-033: sessão de `provider` válida, mas a org está `suspended`/`cancelled` (D-33-3/D-33-4) — escrita/operação bloqueada. */
export class OrgSuspendedError extends Error {
  constructor() {
    super("Assinatura pendente ou cancelada.");
    this.name = "OrgSuspendedError";
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

/**
 * SPEC-033: como `requireProviderOrg()`, mas ADEMAIS bloqueia toda escrita/operação quando a org está
 * `suspended`/`cancelled` (mapeamento `Subscription.status` -> `Organization.status`, `src/lib/billing/status-map.ts`).
 * Lê o status atual do banco (não confia no `orgId` da sessão sozinho — status pode ter mudado depois do
 * login). D-33-3/D-33-4: dado nunca é apagado, só a escrita é barrada; LEITURA continua liberada e usa
 * `requireProviderOrg()` normalmente (não este helper). Ações de billing que precisam funcionar com a org
 * suspensa (reativar assinatura: `createCheckoutSession`/`createPortalSession`) também usam
 * `requireProviderOrg()` diretamente, nunca este helper.
 */
export async function requireActiveProviderOrg(): Promise<{ user: CurrentUser; orgId: string }> {
  const { user, orgId } = await requireProviderOrg();
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { status: true } });
  if (!org || org.status !== "active") throw new OrgSuspendedError();
  return { user, orgId };
}
