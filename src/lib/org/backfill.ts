import { prisma } from "@/lib/prisma";

/**
 * SPEC-049 (D-049-4): backfill idempotente de `User.lastOrgId`. Só toca usuários com `lastOrgId` NULL que têm ao
 * menos uma Membership — usa a org mais antiga (a original do D-30-1). Reexecutar é no-op. Não altera nenhum outro dado.
 */
export async function backfillLastOrgId(): Promise<{ updated: number }> {
  const users = await prisma.user.findMany({
    where: { lastOrgId: null, memberships: { some: {} } },
    select: { id: true, memberships: { orderBy: { createdAt: "asc" }, take: 1, select: { orgId: true } } },
  });
  let updated = 0;
  for (const u of users) {
    const orgId = u.memberships[0]?.orgId;
    if (!orgId) continue;
    const r = await prisma.user.updateMany({ where: { id: u.id, lastOrgId: null }, data: { lastOrgId: orgId } });
    updated += r.count;
  }
  return { updated };
}
