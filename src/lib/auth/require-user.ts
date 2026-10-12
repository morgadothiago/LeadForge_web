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
  /** SPEC-055: e-mail confirmado (D-055-7: nao verificado nao pode ENVIAR mensagens; o resto do app segue liberado). A UI usa para o banner. */
  emailVerified: boolean;
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
 * SPEC-049: a sessão de `provider` também é rejeitada se o usuário não tem mais `Membership` na org do token
 * (removido/saiu) — a troca de org reemite o JWT (`switchActiveOrganization`).
 */
export async function requireUser(): Promise<CurrentUser> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      sessionsInvalidatedAt: true,
      emailVerifiedAt: true,
      // SPEC-049 (D-049-5): a org ativa da sessão só vale enquanto o usuário ainda tem Membership nela.
      memberships: { where: { orgId: session.orgId ?? "" }, select: { orgId: true }, take: 1 },
    },
  });
  if (!user) throw new UnauthorizedError();
  // Usuário removido da org (ou que saiu) perde a sessão dela imediatamente, sem esperar o JWT expirar.
  if (session.platformRole === "provider" && session.orgId && user.memberships.length === 0) throw new UnauthorizedError();
  if (user.sessionsInvalidatedAt && session.issuedAtMs < user.sessionsInvalidatedAt.getTime()) {
    throw new UnauthorizedError();
  }
  return { id: user.id, name: user.name, email: user.email, role: user.role, orgId: session.orgId, platformRole: session.platformRole, emailVerified: user.emailVerifiedAt !== null };
}

/**
 * SPEC-032/037: destino de `platform_admin` x `provider` com org. SPEC-062: o destino real do usuario logado vem do ESTADO da
 * conta (`resolveHomeRoute`/`resolveSessionHomeRoute` em `account-stage.ts`; sem org => `/assinar` etc.); esta funcao so
 * descreve o caso "com org". `platform_admin` nunca fica no "/dashboard" fixo. `platform_admin` não tem Organization (D-30-1), então `/dashboard` (que exige
 * `requireProviderOrg()`) lançaria `ForbiddenError`; o home dele é a área cross-tenant.
 */
export function homeRouteFor(platformRole: PlatformRole): string {
  return platformRole === "platform_admin" ? "/admin/organizacoes" : "/dashboard";
}
