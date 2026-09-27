import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { computeOrgStatus, PAST_DUE_GRACE_MS, syncOrgStatuses } from "./status-map";

const now = new Date("2026-01-15T12:00:00Z");

describe("computeOrgStatus (SPEC-033 D-33-3/D-33-4)", () => {
  it("sem Subscription -> active (nunca bloqueia por omissão)", () => {
    expect(computeOrgStatus(null, now)).toBe("active");
  });
  it("trialing -> active", () => {
    expect(computeOrgStatus({ status: "trialing", pastDueSince: null }, now)).toBe("active");
  });
  it("active -> active", () => {
    expect(computeOrgStatus({ status: "active", pastDueSince: null }, now)).toBe("active");
  });
  it("past_due dentro do grace (7d) -> active", () => {
    const pastDueSince = new Date(now.getTime() - (PAST_DUE_GRACE_MS - 1000));
    expect(computeOrgStatus({ status: "past_due", pastDueSince }, now)).toBe("active");
  });
  it("past_due no limite exato do grace -> suspended", () => {
    const pastDueSince = new Date(now.getTime() - PAST_DUE_GRACE_MS);
    expect(computeOrgStatus({ status: "past_due", pastDueSince }, now)).toBe("suspended");
  });
  it("past_due fora do grace (>7d) -> suspended", () => {
    const pastDueSince = new Date(now.getTime() - (PAST_DUE_GRACE_MS + 1000));
    expect(computeOrgStatus({ status: "past_due", pastDueSince }, now)).toBe("suspended");
  });
  it("past_due sem pastDueSince (evento malformado) -> trata como 'desde agora' -> active", () => {
    expect(computeOrgStatus({ status: "past_due", pastDueSince: null }, now)).toBe("active");
  });
  it("canceled -> suspended (soft-block imediato, D-33-4)", () => {
    expect(computeOrgStatus({ status: "canceled", pastDueSince: null }, now)).toBe("suspended");
  });
  it("incomplete -> suspended", () => {
    expect(computeOrgStatus({ status: "incomplete", pastDueSince: null }, now)).toBe("suspended");
  });
});

/**
 * SPEC-039 (correção QA): `syncOrgStatuses` é o único lugar que grava `suspendedReason: "automatic"` —
 * cobre exatamente o achado do QA sobre `suspendedReason` nunca ser inferido, sempre gravado no momento
 * exato da transição.
 */
describe("syncOrgStatuses grava suspendedReason (SPEC-039, correção QA)", () => {
  let org: TestOrg;
  let planId: string;

  beforeAll(async () => {
    org = await createTestOrg("sync-org-statuses");
    planId = (await prisma.plan.findUniqueOrThrow({ where: { key: "starter" }, select: { id: true } })).id;
  });
  afterAll(() => purgeTestOrg(org));

  it("past_due com grace expirado -> suspende e grava suspendedReason 'automatic'", async () => {
    const now = new Date();
    const pastDueSince = new Date(now.getTime() - (PAST_DUE_GRACE_MS + 1000));
    await prisma.subscription.create({ data: { orgId: org.orgId, planId, status: "past_due", cadence: "monthly", pastDueSince } });

    await syncOrgStatuses(now);

    const after = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId }, select: { status: true, suspendedReason: true } });
    expect(after.status).toBe("suspended");
    expect(after.suspendedReason).toBe("automatic");

    await prisma.subscription.delete({ where: { orgId: org.orgId } });
    await prisma.organization.update({ where: { id: org.orgId }, data: { status: "active", suspendedReason: null } });
  });

  it("org já suspensa MANUALMENTE (suspendedReason 'manual') não é sobrescrita quando a subscription também está em past_due expirado (sem mudança de status -> não toca em suspendedReason)", async () => {
    const now = new Date();
    const pastDueSince = new Date(now.getTime() - (PAST_DUE_GRACE_MS + 1000));
    await prisma.subscription.create({ data: { orgId: org.orgId, planId, status: "past_due", cadence: "monthly", pastDueSince } });
    // simula suspendOrganization manual, já com a subscription em past_due expirado.
    await prisma.organization.update({ where: { id: org.orgId }, data: { status: "suspended", suspendedReason: "manual" } });

    await syncOrgStatuses(now); // computeOrgStatus também resolve "suspended" -> sem mudança de status.

    const after = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId }, select: { status: true, suspendedReason: true } });
    expect(after.status).toBe("suspended");
    expect(after.suspendedReason).toBe("manual"); // preservado — D-039-1.

    await prisma.subscription.delete({ where: { orgId: org.orgId } });
    await prisma.organization.update({ where: { id: org.orgId }, data: { status: "active", suspendedReason: null } });
  });

  it("volta a ficar em dia -> reativa e limpa suspendedReason", async () => {
    const now = new Date();
    const pastDueSince = new Date(now.getTime() - (PAST_DUE_GRACE_MS + 1000));
    await prisma.subscription.create({ data: { orgId: org.orgId, planId, status: "past_due", cadence: "monthly", pastDueSince } });
    await prisma.organization.update({ where: { id: org.orgId }, data: { status: "suspended", suspendedReason: "automatic" } });

    await prisma.subscription.update({ where: { orgId: org.orgId }, data: { status: "active", pastDueSince: null } });
    await syncOrgStatuses(now);

    const after = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId }, select: { status: true, suspendedReason: true } });
    expect(after.status).toBe("active");
    expect(after.suspendedReason).toBeNull();

    await prisma.subscription.delete({ where: { orgId: org.orgId } });
  });
});
