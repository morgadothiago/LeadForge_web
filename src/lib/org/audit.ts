import type { Prisma, PrismaClient } from "@prisma/client";

/** SPEC-049 (D-049-6): eventos auditados por org. NUNCA gravar token/código em `meta`. */
export type OrgAuditAction =
  | "org_created"
  | "org_renamed"
  | "member_invited"
  | "invite_revoked"
  | "member_joined"
  | "member_left"
  | "member_removed"
  | "role_changed"
  | "join_code_generated"
  | "join_code_disabled"
  // SPEC-068a: resposta manual na caixa de atendimento (meta SEM texto e SEM telefone).
  | "inbox_manual_sent"
  // SPEC-069c: o platform_admin mudou a POLITICA da org (override, agentes, integracao). meta = area + nomes dos campos (sem segredo).
  | "admin_policy_changed";

type Db = PrismaClient | Prisma.TransactionClient;

export async function recordOrgAudit(
  db: Db,
  e: { orgId: string; actorUserId: string | null; action: OrgAuditAction; targetUserId?: string | null; meta?: Prisma.InputJsonValue },
): Promise<void> {
  await db.orgAuditLog.create({
    data: { orgId: e.orgId, actorUserId: e.actorUserId, action: e.action, targetUserId: e.targetUserId ?? null, meta: e.meta },
  });
}
