import type { BillingCadence, OrgStatus, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireProviderOrgAllowExpired } from "@/lib/auth/require-admin";

/** SPEC-034 — leitura autenticada (org da sessão) para a tela Configurações > Assinatura. `listActivePlans` (catálogo público) mora em `@/lib/billing/plans` — ver comentário lá para o porquê de não estar aqui. */

export interface SubscriptionView {
  planKey: string;
  planName: string;
  status: SubscriptionStatus;
  cadence: BillingCadence;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
  /** SPEC-053b: ancora da retenção de 90 dias (expurgo = canceledAt + 90d); null enquanto não efetivado. */
  canceledAt: Date | null;
}

export interface BillingSummary {
  /** SPEC-065b: quem tem nome/e-mail para exibir ao membro ("peca ao proprietario"). `null` se nao achou owner. */
  ownerName: string | null;
  /** SPEC-065b (D-065-19/27): o trial NASCEU expirado (e-mail/CPF/CNPJ ja usaram o teste, IP/dominio): a tela usa a mensagem generica, sem dizer qual dado bateu. */
  trialNeverGranted: boolean;
  orgStatus: OrgStatus;
  /** Só o `owner` (Membership.orgRole) gerencia a assinatura — UX só; a barreira real é `requireOwner()` nas actions. */
  isOwner: boolean;
  /** null só deveria acontecer para orgs pré-SPEC-033/dado inconsistente; nunca para orgs criadas por `startPlanCheckout`/`completeOrganizationSetup` (SPEC-062: o signUp cria só o usuário; a casca nasce no checkout). */
  subscription: SubscriptionView | null;
}

/** Resumo da assinatura da org da sessão. Usa `requireProviderOrg()` (não `requireActiveProviderOrg()`): precisa funcionar com a org suspensa, para o owner conseguir reativar. */
export async function getBillingSummary(): Promise<BillingSummary> {
  const { user, orgId } = await requireProviderOrgAllowExpired(); // SPEC-065 (D-065-13.2): allowlist (a tela de assinatura precisa abrir com o trial expirado)
  const [org, membership, sub, owner] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { status: true, createdAt: true } }),
    prisma.membership.findUnique({ where: { userId_orgId: { userId: user.id, orgId } }, select: { orgRole: true } }),
    prisma.subscription.findUnique({
      where: { orgId },
      select: { status: true, cadence: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, trialEndsAt: true, canceledAt: true, plan: { select: { key: true, name: true } } },
    }),
    prisma.membership.findFirst({ where: { orgId, orgRole: "owner" }, orderBy: { createdAt: "asc" }, select: { user: { select: { name: true } } } }),
  ]);
  return {
    ownerName: owner?.user.name ?? null,
    // Trial concedido dura 14 dias a partir do cadastro; "nasceu expirado" = `trialEndsAt <= criacao da org + 60 s` (o backend grava trialEndsAt = agora na mesma transacao; anti-abuso, 065a).
    trialNeverGranted: Boolean(sub && sub.status === "trialing" && sub.trialEndsAt && sub.trialEndsAt.getTime() <= org.createdAt.getTime() + 60_000),
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
          canceledAt: sub.canceledAt,
        }
      : null,
  };
}

/** Só o status (para o banner global "assinatura pendente", SPEC-034). `null` = sem sessão de provider (platform_admin ou erro) — o chamador trata como "sem banner". */
export async function getOrgStatusForBanner(): Promise<OrgStatus | null> {
  const { orgId } = await requireProviderOrgAllowExpired(); // SPEC-065 (D-065-13.2): allowlist (a tela de assinatura precisa abrir com o trial expirado)
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { status: true } });
  return org?.status ?? null;
}

/**
 * SPEC-062b — status da org + sinal do ramo LEGADO de trial vencido (D-062-17): `trialExpired` = assinatura `trialing` sem
 * `trialEndsAt` futuro. Mesmo contrato de erro de `getOrgStatusForBanner` (lança sem sessão de provider com org).
 */
export async function getOrgBannerState(now: Date = new Date()): Promise<{ status: OrgStatus; trialExpired: boolean; trialEndsAt: Date | null; subscriptionStatus: SubscriptionStatus | null } | null> {
  const { orgId } = await requireProviderOrgAllowExpired(); // SPEC-065 (D-065-13.2): allowlist (a tela de assinatura precisa abrir com o trial expirado)
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { status: true, subscription: { select: { status: true, trialEndsAt: true } } },
  });
  if (!org) return null;
  const sub = org.subscription;
  const trialExpired = org.status !== "active" && sub?.status === "trialing" && !(sub.trialEndsAt && sub.trialEndsAt.getTime() > now.getTime());
  return { status: org.status, trialExpired, trialEndsAt: sub?.trialEndsAt ?? null, subscriptionStatus: sub?.status ?? null };
}
