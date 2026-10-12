import type { OrgRole, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, requireProviderOrg, requireProviderOrgAllowExpired } from "@/lib/auth/require-admin";
import type { CurrentUser } from "@/lib/auth/require-user";

/** SPEC-049: papel do usuário na org ATIVA da sessão (null se não houver Membership — sessão já seria rejeitada por requireUser). */
export async function getActiveOrgRole(userId: string, orgId: string): Promise<OrgRole | null> {
  const m = await prisma.membership.findUnique({ where: { userId_orgId: { userId, orgId } }, select: { orgRole: true } });
  return m?.orgRole ?? null;
}

/** Sessão de provider na org ativa, qualquer papel. Não exige org `active` (membros podem listar/sair com a org suspensa). */
export async function requireOrgMember(opts: { allowExpired?: boolean } = {}): Promise<{ user: CurrentUser; orgId: string; orgRole: OrgRole }> {
  // SPEC-065 (D-065-13.2): `allowExpired` so para `leaveOrganization` (allowlist fechada).
  const { user, orgId } = await (opts.allowExpired ? requireProviderOrgAllowExpired() : requireProviderOrg());
  const orgRole = await getActiveOrgRole(user.id, orgId);
  if (!orgRole) throw new ForbiddenError();
  return { user, orgId, orgRole };
}

/** Só `owner` da org ativa (D-049-1: convida/remove/altera papéis/gere billing). */
export async function requireOrgOwner(): Promise<{ user: CurrentUser; orgId: string }> {
  const { user, orgId, orgRole } = await requireOrgMember();
  if (orgRole !== "owner") throw new ForbiddenError();
  return { user, orgId };
}

/**
 * Serializa mutações de membros da org (lock de linha em `Organization`) — evita que dois owners se rebaixem/removam
 * ao mesmo tempo e deixem a org sem owner (D-049-1). Chamar DENTRO de `prisma.$transaction`.
 */
export async function lockOrg(tx: Prisma.TransactionClient, orgId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${orgId} FOR UPDATE`;
}

/** Reconfirma, DENTRO da transação e após `lockOrg`, que o ator ainda é owner (o papel lido antes do lock pode estar velho). */
export async function actorIsOwner(tx: Prisma.TransactionClient, orgId: string, userId: string): Promise<boolean> {
  const m = await tx.membership.findUnique({ where: { userId_orgId: { userId, orgId } }, select: { orgRole: true } });
  return m?.orgRole === "owner";
}

/**
 * D-049-13: quando alguém deixa de ser owner (removido, rebaixado ou saiu), revoga os convites pendentes que ele criou e
 * desabilita o código de entrada se foi ele quem o gerou mais recentemente (via OrgAuditLog; sem coluna nova). Dentro da tx.
 */
export async function revokeOwnerArtifacts(tx: Prisma.TransactionClient, orgId: string, userId: string, now: Date = new Date()): Promise<void> {
  await tx.orgInvite.updateMany({ where: { orgId, createdByUserId: userId, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
  const lastGen = await tx.orgAuditLog.findFirst({ where: { orgId, action: "join_code_generated" }, orderBy: { createdAt: "desc" }, select: { actorUserId: true } });
  if (lastGen?.actorUserId === userId) {
    await tx.organization.update({ where: { id: orgId }, data: { joinCode: null, joinCodeExpiresAt: null, joinCodeMaxUses: null, joinCodeUses: 0 } });
  }
}
