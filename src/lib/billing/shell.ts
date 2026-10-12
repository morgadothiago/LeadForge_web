import type { Prisma, PrismaClient, SubscriptionStatus } from "@prisma/client";

/**
 * SPEC-062 (D-062-5) — "casca de cobranca" (billing shell): `Organization` tecnica, criada ao iniciar o checkout, com
 * `setupPendingSince` NAO nulo, que liga o pagamento (sempre por `orgId`) a uma organizacao que o usuario ainda nao
 * nomeou. NAO e uma organizacao para o usuario: toda lista/seletor/org ativa/convite/codigo/tick/admin-padrao a ignora.
 * Este modulo e o ponto UNICO do filtro (`NOT_SHELL`) e dos helpers; nenhum outro arquivo deve reescrever a regra.
 */
export type Db = PrismaClient | Prisma.TransactionClient;

/** Filtro `where` de `Organization`: so organizacoes REAIS (nao casca). */
export const NOT_SHELL = { setupPendingSince: null } as const satisfies Prisma.OrganizationWhereInput;
/** Filtro `where` de `Organization`: so cascas. */
export const IS_SHELL = { setupPendingSince: { not: null } } as const satisfies Prisma.OrganizationWhereInput;

export function isShell(org: { setupPendingSince: Date | null }): boolean {
  return org.setupPendingSince !== null;
}

/** D-062-18: casca sem pagamento e apagada apos 7 dias. */
export const SHELL_ABANDON_MS = 7 * 24 * 3600_000;
export const SHELL_NAME = "Organização em configuração";

export interface UserShell {
  orgId: string;
  setupPendingSince: Date;
  subscriptionStatus: SubscriptionStatus | null;
  planKey: string | null;
  cadence: "monthly" | "yearly" | null;
}

/** Casca do usuario (owner). No maximo 1 por usuario (garantido por `startPlanCheckout` sob lock de `User`). */
export async function findUserShell(db: Db, userId: string): Promise<UserShell | null> {
  const m = await db.membership.findFirst({
    where: { userId, orgRole: "owner", org: IS_SHELL },
    orderBy: { createdAt: "asc" },
    select: {
      orgId: true,
      org: { select: { setupPendingSince: true, subscription: { select: { status: true, cadence: true, plan: { select: { key: true } } } } } },
    },
  });
  if (!m || !m.org.setupPendingSince) return null;
  const sub = m.org.subscription;
  return { orgId: m.orgId, setupPendingSince: m.org.setupPendingSince, subscriptionStatus: sub?.status ?? null, planKey: sub?.plan.key ?? null, cadence: sub?.cadence ?? null };
}

/** Serializa `startPlanCheckout`/`completeOrganizationSetup` do mesmo usuario (no maximo 1 casca por usuario). Dentro de `$transaction`. */
export async function lockUser(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
}
