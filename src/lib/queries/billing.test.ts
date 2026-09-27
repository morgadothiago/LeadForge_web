import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { signInAs, signOut } from "@/lib/auth/test-helpers";
import { getBillingSummary, getOrgStatusForBanner } from "./billing";

let org: TestOrg;
let memberUserId: string;
let starterPlanId: string;

beforeAll(async () => {
  org = await createTestOrg("billing-queries");
  memberUserId = randomUUID();
  await prisma.user.create({ data: { id: memberUserId, name: "zz member", email: `zz-member-${memberUserId.slice(0, 8)}@test.local`, role: "provider" } });
  await prisma.membership.create({ data: { userId: memberUserId, orgId: org.orgId, orgRole: "member" } });
  starterPlanId = (await prisma.plan.findUniqueOrThrow({ where: { key: "starter" }, select: { id: true } })).id;
});
afterEach(async () => {
  signOut();
  await prisma.subscription.deleteMany({ where: { orgId: org.orgId } });
  await prisma.organization.update({ where: { id: org.orgId }, data: { status: "active" } });
});
afterAll(async () => {
  await prisma.membership.deleteMany({ where: { userId: memberUserId } });
  await prisma.user.deleteMany({ where: { id: memberUserId } });
  await purgeTestOrg(org);
});

describe("getBillingSummary (SPEC-034)", () => {
  it("sem sessão -> lança (UnauthorizedError, via requireProviderOrg)", async () => {
    await expect(getBillingSummary()).rejects.toThrow();
  });

  it("sem Subscription -> subscription null, orgStatus active", async () => {
    await signInAs(org.userId, { orgId: org.orgId, platformRole: "provider" });
    const r = await getBillingSummary();
    expect(r.subscription).toBeNull();
    expect(r.orgStatus).toBe("active");
    expect(r.isOwner).toBe(true);
  });

  it("member (não owner) -> isOwner false", async () => {
    await signInAs(memberUserId, { orgId: org.orgId, platformRole: "provider" });
    const r = await getBillingSummary();
    expect(r.isOwner).toBe(false);
  });

  it("com Subscription -> devolve plano/status/cadência/datas", async () => {
    const trialEndsAt = new Date(Date.now() + 14 * 24 * 3600_000);
    await prisma.subscription.create({ data: { orgId: org.orgId, planId: starterPlanId, status: "trialing", cadence: "monthly", trialEndsAt } });
    await signInAs(org.userId, { orgId: org.orgId, platformRole: "provider" });
    const r = await getBillingSummary();
    expect(r.subscription).not.toBeNull();
    expect(r.subscription?.planKey).toBe("starter");
    expect(r.subscription?.status).toBe("trialing");
    expect(r.subscription?.cadence).toBe("monthly");
    expect(r.subscription?.trialEndsAt?.getTime()).toBe(trialEndsAt.getTime());
  });

  it("funciona com a org suspensa (owner precisa ver o próprio status para reativar)", async () => {
    await prisma.organization.update({ where: { id: org.orgId }, data: { status: "suspended" } });
    await signInAs(org.userId, { orgId: org.orgId, platformRole: "provider" });
    const r = await getBillingSummary();
    expect(r.orgStatus).toBe("suspended");
  });
});

describe("getOrgStatusForBanner (SPEC-034)", () => {
  it("org ativa -> 'active'", async () => {
    await signInAs(org.userId, { orgId: org.orgId, platformRole: "provider" });
    expect(await getOrgStatusForBanner()).toBe("active");
  });

  it("org suspensa -> 'suspended'", async () => {
    await prisma.organization.update({ where: { id: org.orgId }, data: { status: "suspended" } });
    await signInAs(org.userId, { orgId: org.orgId, platformRole: "provider" });
    expect(await getOrgStatusForBanner()).toBe("suspended");
  });

  it("sem sessão -> lança (o componente do banner trata como 'sem faixa', não aqui)", async () => {
    await expect(getOrgStatusForBanner()).rejects.toThrow();
  });
});
