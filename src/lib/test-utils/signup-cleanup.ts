import { prisma } from "@/lib/prisma";

/** APENAS testes: apaga usuarios criados por `signUp` (e suas orgs/assinaturas). `TrialClaim` NAO e apagado de proposito (sobrevive a exclusao). */
export async function cleanupSignedUp(emails: string[]): Promise<void> {
  const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, memberships: { select: { orgId: true } } } });
  for (const u of users) {
    for (const m of u.memberships) {
      await prisma.usageCounter.deleteMany({ where: { orgId: m.orgId } });
      await prisma.membership.deleteMany({ where: { orgId: m.orgId } });
      await prisma.orgAuditLog.deleteMany({ where: { orgId: m.orgId } });
      await prisma.billingReminderLog.deleteMany({ where: { orgId: m.orgId } });
      await prisma.organization.deleteMany({ where: { id: m.orgId } });
    }
    await prisma.emailVerificationToken.deleteMany({ where: { userId: u.id } });
    await prisma.emailDispatchLog.deleteMany({ where: { userId: u.id } });
    await prisma.user.deleteMany({ where: { id: u.id } });
  }
}
