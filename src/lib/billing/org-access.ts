import { resolveOrgAccess, type OrgAccessState } from "./access";
import type { Db } from "./limits";

/**
 * SPEC-065 (D-065-12/13.5): estado de acesso de uma organizacao lido do banco, para os caminhos SEM sessao (webhooks/ingestao/scheduler) que
 * agem pela organizacao. Org inexistente => `null`. Mesma `resolveOrgAccess` das guardas com sessao.
 */
export async function loadOrgAccess(db: Db, orgId: string, now: Date): Promise<OrgAccessState | null> {
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { status: true, subscription: { select: { status: true, pastDueSince: true, cancelAtPeriodEnd: true, currentPeriodEnd: true, trialEndsAt: true } } },
  });
  if (!org) return null;
  return resolveOrgAccess(org.subscription, org, now);
}
