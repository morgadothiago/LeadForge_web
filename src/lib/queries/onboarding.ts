import { prisma } from "@/lib/prisma";
import { requireProviderOrg } from "@/lib/auth/require-admin";

/**
 * SPEC-065b (D-065-22/24) — dados do dashboard de primeiro acesso: nome da organizacao (cartao "Como se chama a sua empresa?") e
 * progresso dos "primeiros passos" (canal conectado, campanha, leads). So leitura, escopado pela org da sessao (`requireProviderOrg`).
 */
export interface DashboardOnboarding {
  orgId: string;
  orgName: string;
  isOwner: boolean;
  /** O nome ainda e o automatico do cadastro ("Empresa de {primeiro nome}"): so ai o cartao de nome faz sentido. */
  hasDefaultName: boolean;
  steps: { channel: boolean; campaign: boolean; leads: boolean };
}

export const DEFAULT_ORG_NAME_PREFIX = "Empresa de ";

export async function getDashboardOnboarding(): Promise<DashboardOnboarding> {
  const { user, orgId } = await requireProviderOrg();
  const [org, membership, emailAccounts, whatsapp, campaigns, leads] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true } }),
    prisma.membership.findUnique({ where: { userId_orgId: { userId: user.id, orgId } }, select: { orgRole: true } }),
    prisma.emailAccount.count({ where: { orgId } }),
    prisma.whatsAppInstance.count({ where: { orgId } }),
    prisma.campaign.count({ where: { orgId } }),
    prisma.lead.count({ where: { campaign: { orgId } } }),
  ]);
  return {
    orgId,
    orgName: org.name,
    isOwner: membership?.orgRole === "owner",
    hasDefaultName: org.name.startsWith(DEFAULT_ORG_NAME_PREFIX),
    steps: { channel: emailAccounts + whatsapp > 0, campaign: campaigns > 0, leads: leads > 0 },
  };
}
