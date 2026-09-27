import type { BillingCadence, OrgStatus, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireProviderOrg } from "@/lib/auth/require-admin";

/** SPEC-034 — leitura autenticada (org da sessão) para a tela Configurações > Assinatura. `listActivePlans` (catálogo público) mora em `@/lib/billing/plans` — ver comentário lá para o porquê de não estar aqui. */

export interface SubscriptionView {
  planKey: string;
  planName: string;
  status: SubscriptionStatus;
  cadence: BillingCadence;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
}

export interface BillingSummary {
  orgStatus: OrgStatus;
  /** Só o `owner` (Membership.orgRole) gerencia a assinatura — UX só; a barreira real é `requireOwner()` nas actions. */
  isOwner: boolean;
  /** null só deveria acontecer para orgs pré-SPEC-033/dado inconsistente; nunca para orgs criadas por `signUpAndStartCheckout`. */
  subscription: SubscriptionView | null;
}

/** Resumo da assinatura da org da sessão. Usa `requireProviderOrg()` (não `requireActiveProviderOrg()`): precisa funcionar com a org suspensa, para o owner conseguir reativar. */
export async function getBillingSummary(): Promise<BillingSummary> {
  const { user, orgId } = await requireProviderOrg();
  const [org, membership, sub] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { status: true } }),
    prisma.membership.findUnique({ where: { userId_orgId: { userId: user.id, orgId } }, select: { orgRole: true } }),
    prisma.subscription.findUnique({
      where: { orgId },
      select: { status: true, cadence: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, trialEndsAt: true, plan: { select: { key: true, name: true } } },
    }),
  ]);
  return {
    orgStatus: org.status,
    isOwner: membership?.orgRole === "owner",
    subscription: sub
      ? {
          planKey: sub.plan.key,
          planName: sub.plan.name,
          status: sub.status,
          cadence: sub.cadence,
          currentPeriodEnd: sub.currentPeriodEnd,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          trialEndsAt: sub.trialEndsAt,
        }
      : null,
  };
}

/** Só o status (para o banner global "assinatura pendente", SPEC-034). `null` = sem sessão de provider (platform_admin ou erro) — o chamador trata como "sem banner". */
export async function getOrgStatusForBanner(): Promise<OrgStatus | null> {
  const { orgId } = await requireProviderOrg();
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { status: true } });
  return org?.status ?? null;
}
