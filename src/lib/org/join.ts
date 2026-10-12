import type { OrgRole, Prisma } from "@prisma/client";
import { recordOrgAudit } from "./audit";

/**
 * SPEC-049: núcleo transacional de "entrar numa organização" (convite nominal ou código). Tudo roda DENTRO da
 * transação do chamador: se qualquer passo lançar (ex.: já é membro), o "claim" do convite/código é revertido —
 * um convite/uso de código nunca é queimado por uma entrada que não aconteceu.
 */
export class JoinInvalidError extends Error {
  constructor() {
    super("join inválido");
    this.name = "JoinInvalidError";
  }
}
export class AlreadyMemberError extends Error {
  constructor() {
    super("já é membro");
    this.name = "AlreadyMemberError";
  }
}

export type JoinVia = "invite" | "code" | "signup_invite" | "signup_code";

async function addMember(
  tx: Prisma.TransactionClient,
  p: { orgId: string; userId: string; orgRole: OrgRole; via: JoinVia; actorUserId: string | null },
): Promise<void> {
  const org = await tx.organization.findUnique({ where: { id: p.orgId }, select: { status: true, setupPendingSince: true } });
  // SPEC-062 (D-062-15): casca de cobranca nao recebe membros (nem por convite nem por codigo).
  if (!org || org.status === "cancelled" || org.setupPendingSince) throw new JoinInvalidError();
  const exists = await tx.membership.findUnique({ where: { userId_orgId: { userId: p.userId, orgId: p.orgId } }, select: { id: true } });
  if (exists) throw new AlreadyMemberError();
  await tx.membership.create({ data: { userId: p.userId, orgId: p.orgId, orgRole: p.orgRole } });
  await tx.user.update({ where: { id: p.userId }, data: { lastOrgId: p.orgId } });
  await recordOrgAudit(tx, { orgId: p.orgId, actorUserId: p.actorUserId, action: "member_joined", targetUserId: p.userId, meta: { via: p.via, orgRole: p.orgRole } });
}

/** Consome (uso único, atômico) o convite nominal e cria a Membership. `userEmail` precisa ser igual ao do convite (case-insensitive, já em minúsculas). */
export async function joinWithInvite(
  tx: Prisma.TransactionClient,
  p: { tokenHash: string; userId: string; userEmail: string; now: Date; via: "invite" | "signup_invite" },
): Promise<{ orgId: string; orgRole: OrgRole }> {
  const claim = await tx.orgInvite.updateMany({
    where: { tokenHash: p.tokenHash, usedAt: null, revokedAt: null, expiresAt: { gt: p.now }, email: p.userEmail.toLowerCase() },
    data: { usedAt: p.now, usedByUserId: p.userId },
  });
  if (claim.count === 0) throw new JoinInvalidError();
  const invite = await tx.orgInvite.findUniqueOrThrow({ where: { tokenHash: p.tokenHash }, select: { orgId: true, orgRole: true, createdByUserId: true } });
  await addMember(tx, { orgId: invite.orgId, userId: p.userId, orgRole: invite.orgRole, via: p.via, actorUserId: invite.createdByUserId });
  return { orgId: invite.orgId, orgRole: invite.orgRole };
}

/** Consome 1 uso do código (atômico: respeita expiração e limite de usos sob concorrência) e cria Membership `member` (D-049-2: sem aprovação). */
export async function joinWithCode(
  tx: Prisma.TransactionClient,
  p: { code: string; userId: string; now: Date; via: "code" | "signup_code" },
): Promise<{ orgId: string; orgRole: OrgRole }> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "Organization" SET "joinCodeUses" = "joinCodeUses" + 1
    WHERE "joinCode" = ${p.code} AND "joinCodeExpiresAt" > ${p.now} AND "joinCodeUses" < "joinCodeMaxUses" AND "status" <> 'cancelled'::"OrgStatus" AND "setupPendingSince" IS NULL
    RETURNING "id"`;
  const orgId = rows[0]?.id;
  if (!orgId) throw new JoinInvalidError();
  await addMember(tx, { orgId, userId: p.userId, orgRole: "member", via: p.via, actorUserId: null });
  return { orgId, orgRole: "member" };
}
