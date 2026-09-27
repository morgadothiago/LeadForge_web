import { prisma } from "@/lib/prisma";
import { getSession } from "./session";
import type { PlatformRole } from "./session-token";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  /** SPEC-030: valor bruto de User.role ("platform_admin" | "provider") — mantido por compat com código legado que ainda lê `.role`. Prefira `platformRole`/`orgId` abaixo. */
  role: string;
  /** SPEC-030: org ativa da sessão. null só para platform_admin. */
  orgId: string | null;
  /** SPEC-030: papel de PLATAFORMA da sessão (nunca o `Membership.orgRole`). */
  platformRole: PlatformRole;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Não autenticado.");
    this.name = "UnauthorizedError";
  }
}

/**
 * Único helper de autenticação das actions/queries: valida a sessão e relê o usuário no banco.
 * SPEC-030: também relê `orgId`/`platformRole` da SESSÃO (não do banco — a org ativa é decidida no
 * login, D-30-4 deixa seleção de org fora de escopo). Se a sessão não bate mais com o usuário
 * (ex.: token de sessão antigo, pré-migração), trata como não autenticado.
 * SPEC-038 (D-038-2): se `User.sessionsInvalidatedAt` for posterior ao `issuedAtMs` do token (sessão
 * emitida ANTES de uma redefinição de senha), trata como não autenticado — é assim que a sessão JWT
 * stateless (sem tabela de sessões pra revogar) é "encerrada" ao redefinir a senha.
 */
export async function requireUser(): Promise<CurrentUser> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true, email: true, role: true, sessionsInvalidatedAt: true },
  });
  if (!user) throw new UnauthorizedError();
  if (user.sessionsInvalidatedAt && session.issuedAtMs < user.sessionsInvalidatedAt.getTime()) {
    throw new UnauthorizedError();
  }
  return { id: user.id, name: user.name, email: user.email, role: user.role, orgId: session.orgId, platformRole: session.platformRole };
}

/**
 * SPEC-032/037: destino pós-login/pós-signup/pós-"/" para usuário autenticado — nunca "/dashboard"
 * fixo. `platform_admin` não tem Organization (D-30-1), então `/dashboard` (que exige
 * `requireProviderOrg()`) lançaria `ForbiddenError`; o home dele é a área cross-tenant.
 */
export function homeRouteFor(platformRole: PlatformRole): string {
  return platformRole === "platform_admin" ? "/admin/organizacoes" : "/dashboard";
}
