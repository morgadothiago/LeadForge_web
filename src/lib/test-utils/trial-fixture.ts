import type { CampaignStatus, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { FEATURE_KEYS, NEW_LIMIT_KEYS } from "@/lib/billing/plan-catalog";
import type { TestOrg } from "./org-fixture";

/** SPEC-069b: planos de teste legados (so com limites antigos) NAO devem travar features/limites novos: tudo liberado e ilimitado, salvo o que o teste passar. */
const OPEN_ENTITLEMENTS = {
  ...Object.fromEntries(NEW_LIMIT_KEYS.map((k) => [k, null])),
  features: Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])),
};

/** SPEC-069b: libera TODAS as features e deixa ilimitados os limites novos da org por OVERRIDE (a org de seed esta no Starter). Desfazer com `revokeAllEntitlements`. */
export async function grantAllEntitlements(orgId: string): Promise<void> {
  const features = Object.fromEntries(FEATURE_KEYS.map((k) => [k, true]));
  const limits = Object.fromEntries(NEW_LIMIT_KEYS.map((k) => [k, null]));
  await prisma.orgEntitlementOverride.upsert({
    where: { orgId },
    update: { features, limits, reason: "teste", expiresAt: null },
    create: { orgId, features, limits, reason: "teste", createdBy: "teste" },
  });
}
export async function revokeAllEntitlements(orgId: string): Promise<void> {
  await prisma.orgEntitlementOverride.deleteMany({ where: { orgId } });
}

/** APENAS testes (SPEC-065): planos de teste (inativos: nunca aparecem na vitrine) com limites sob medida. */
export async function ensureTestPlan(key: string, limits: Record<string, unknown>): Promise<string> {
  const json = { ...OPEN_ENTITLEMENTS, ...limits };
  const p = await prisma.plan.upsert({
    where: { key },
    update: { limits: json },
    create: { key, name: key, priceMonthlyCents: 0, priceYearlyCents: null, limits: json, active: false, selfServiceCheckout: false },
    select: { id: true },
  });
  return p.id;
}

export const DAY = 24 * 3600_000;

/** Coloca a org num plano (por key) com o status/trial dados; recria a Subscription. Org sem plano = `removeSubscription`. */
export async function setOrgPlan(
  orgId: string,
  opts: { planKey: string; status?: SubscriptionStatus; trialEndsAt?: Date | null; currentPeriodEnd?: Date | null; orgStatus?: "active" | "suspended" },
): Promise<void> {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { key: opts.planKey }, select: { id: true } });
  await prisma.subscription.deleteMany({ where: { orgId } });
  await prisma.subscription.create({
    data: {
      orgId,
      planId: plan.id,
      status: opts.status ?? "trialing",
      cadence: "monthly",
      trialEndsAt: opts.trialEndsAt === undefined ? new Date(Date.now() + 14 * DAY) : opts.trialEndsAt,
      currentPeriodEnd: opts.currentPeriodEnd ?? null,
    },
  });
  if (opts.orgStatus) await prisma.organization.update({ where: { id: orgId }, data: { status: opts.orgStatus } });
}

/** Org em trial ativo (plano de teste com os limites dados) e org em trial EXPIRADO. */
export async function setTrial(orgId: string, planKey: string, expired = false): Promise<void> {
  await setOrgPlan(orgId, { planKey, status: "trialing", trialEndsAt: new Date(Date.now() + (expired ? -DAY : 10 * DAY)) });
}

export async function mkIcp(org: TestOrg): Promise<string> {
  return (await prisma.icpProfile.create({ data: { orgId: org.orgId, name: "zz icp", niche: "n", location: "l", companySize: "1-10", signals: [], keywords: [], sources: [], desiredData: [] }, select: { id: true } })).id;
}

export async function mkCampaign(org: TestOrg, status: CampaignStatus = "active", icpId?: string): Promise<string> {
  const icp = icpId ?? (await mkIcp(org));
  return (await prisma.campaign.create({ data: { orgId: org.orgId, name: `zz camp ${Math.random().toString(36).slice(2, 7)}`, userId: org.userId, icpId: icp, status }, select: { id: true } })).id;
}
