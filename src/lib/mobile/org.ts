import { prisma } from "@/lib/prisma";

/**
 * SPEC-030: o mobile não carrega orgId no token (contrato de auth mantido aditivo/compatível — ver
 * SPEC-030 Riscos); toda leitura/escrita por-org do app resolve a org pela Membership a cada chamada.
 * SPEC-049 (D-049-15): determinístico para usuário em 2+ orgs — `User.lastOrgId` se ainda for membro, senão a
 * Membership mais antiga (createdAt asc, id asc). SPEC-062: ignora a "casca de cobrança" (`setupPendingSince` não nulo; mesmo critério de billing/shell.ts).
 * null = usuário sem org real (platform_admin, ou só com casca).
 */
export async function resolveOrgId(userId: string): Promise<string | null> {
  // 1 query só (a contagem de queries dos endpoints mobile é um critério da SPEC-030; o ORM faria 2). SQL parametrizado ($1).
  const rows = await prisma.$queryRawUnsafe<{ orgId: string }[]>(
    `SELECT m."orgId" FROM "Membership" m JOIN "User" u ON u."id" = m."userId"
     JOIN "Organization" o ON o."id" = m."orgId"
     WHERE m."userId" = $1 AND o."setupPendingSince" IS NULL
     ORDER BY (m."orgId" = u."lastOrgId") DESC, m."createdAt" ASC, m."id" ASC
     LIMIT 1`,
    userId,
  );
  return rows[0]?.orgId ?? null;
}
