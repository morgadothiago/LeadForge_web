import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { signInAs } from "@/lib/auth/test-helpers";
import { createTestOrg, type TestOrg } from "./org-fixture";
import { DAY, setOrgPlan } from "./trial-fixture";

/** APENAS testes (SPEC-069b): org por plano REAL do seed (free/starter/pro/business/courtesy), dono com e-mail verificado e sessao pronta. */
export const PLANS = ["free", "starter", "pro", "business", "courtesy"] as const;
export type RealPlan = (typeof PLANS)[number];

export interface PlanOrg extends TestOrg {
  plan: string;
}

export async function mkPlanOrg(tag: string, plan: string, opts: { status?: "trialing" | "active" | "past_due" | "canceled"; orgStatus?: "active" | "suspended"; pastDueDaysAgo?: number } = {}): Promise<PlanOrg> {
  const o = await createTestOrg(tag);
  await prisma.user.update({ where: { id: o.userId }, data: { emailVerifiedAt: new Date() } });
  const status = opts.status ?? (plan === "free" ? "trialing" : "active");
  await setOrgPlan(o.orgId, { planKey: plan, status, trialEndsAt: status === "trialing" ? new Date(Date.now() + 10 * DAY) : null, currentPeriodEnd: new Date(Date.now() + 20 * DAY), orgStatus: opts.orgStatus });
  if (status === "past_due") await prisma.subscription.update({ where: { orgId: o.orgId }, data: { pastDueSince: new Date(Date.now() - (opts.pastDueDaysAgo ?? 1) * DAY) } });
  return { ...o, plan };
}

/** Troca o plano da org mantendo todos os dados (downgrade/upgrade). */
export async function changePlan(o: PlanOrg, plan: string, status?: "trialing" | "active" | "past_due" | "canceled"): Promise<void> {
  const st = status ?? (plan === "free" ? "trialing" : "active");
  await setOrgPlan(o.orgId, { planKey: plan, status: st, trialEndsAt: st === "trialing" ? new Date(Date.now() + 10 * DAY) : null, currentPeriodEnd: new Date(Date.now() + 20 * DAY) });
  if (st === "past_due") await prisma.subscription.update({ where: { orgId: o.orgId }, data: { pastDueSince: new Date(Date.now() - DAY) } });
  o.plan = plan;
}

export const asOwner = (o: TestOrg) => signInAs(o.userId, { orgId: o.orgId, platformRole: "provider" });

/** Codigo tipado de um `ActionResult` com falha (`errors.code[0]`). */
export const errCode = (r: { ok: boolean; errors?: Record<string, string[]> }): string | undefined => (!r.ok ? r.errors?.code?.[0] : undefined);

/** Plano de teste cujo `limits` e ilegivel (JSON que nao e objeto): fail-closed. */
export async function ensureGarbagePlan(key = "zz-069b-garbage"): Promise<void> {
  await prisma.plan.upsert({
    where: { key },
    update: { limits: "garbage" },
    create: { key, name: key, priceMonthlyCents: 0, priceYearlyCents: null, limits: "garbage", active: false, selfServiceCheckout: false },
  });
}

export const uniq = (): string => randomUUID().slice(0, 8);
