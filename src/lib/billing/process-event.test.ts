import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import type { ParsedBillingEvent } from "./provider";
import { processBillingEvent } from "./process-event";

let org: TestOrg;
let planId: string;
const NOW = new Date("2026-02-01T12:00:00Z");

const baseEvent = (over: Partial<ParsedBillingEvent> = {}): ParsedBillingEvent => ({
  eventId: `zz-evt-${randomUUID()}`,
  type: "subscription.created",
  orgId: org.orgId,
  planKey: "starter",
  cadence: "monthly",
  status: "active",
  currentPeriodEnd: new Date(NOW.getTime() + 30 * 24 * 3600_000),
  cancelAtPeriodEnd: false,
  externalCustomerId: "cus_1",
  externalSubscriptionId: "sub_1",
  ...over,
});

beforeAll(async () => {
  org = await createTestOrg("process-event");
  planId = (await prisma.plan.findUniqueOrThrow({ where: { key: "starter" }, select: { id: true } })).id;
});
afterEach(async () => {
  await prisma.subscription.deleteMany({ where: { orgId: org.orgId } });
  await prisma.webhookEvent.deleteMany({ where: { orgId: org.orgId } });
});
afterAll(() => purgeTestOrg(org));

describe("processBillingEvent (SPEC-033)", () => {
  it("org_not_found: orgId inexistente", async () => {
    const r = await processBillingEvent(baseEvent({ orgId: randomUUID() }), NOW);
    expect(r).toBe("org_not_found");
  });

  it("plan_not_found: planKey inexistente", async () => {
    const r = await processBillingEvent(baseEvent({ planKey: "plano-inexistente" }), NOW);
    expect(r).toBe("plan_not_found");
  });

  it("processed: cria Subscription e Organization.status=active", async () => {
    const r = await processBillingEvent(baseEvent({ status: "active" }), NOW);
    expect(r).toBe("processed");
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { orgId: org.orgId } });
    expect(sub.status).toBe("active");
    expect(sub.planId).toBe(planId);
    const o = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
    expect(o.status).toBe("active");
  });

  it("idempotência: eventId repetido -> 'duplicate', nada muda na 2ª tentativa", async () => {
    const event = baseEvent({ status: "active" });
    expect(await processBillingEvent(event, NOW)).toBe("processed");
    const after1 = await prisma.subscription.findUniqueOrThrow({ where: { orgId: org.orgId } });
    // 2ª tentativa com o MESMO eventId mas status diferente -> deve ser ignorada (duplicate), sem aplicar canceled.
    const r2 = await processBillingEvent({ ...event, status: "canceled" }, NOW);
    expect(r2).toBe("duplicate");
    const after2 = await prisma.subscription.findUniqueOrThrow({ where: { orgId: org.orgId } });
    expect(after2.status).toBe(after1.status);
    expect(after2.status).toBe("active");
  });

  it("eventId global: dois orgs distintos com eventId diferente nunca colidem (sem vazamento cross-tenant)", async () => {
    const org2 = await createTestOrg("process-event-2");
    try {
      const r1 = await processBillingEvent(baseEvent({ status: "active" }), NOW);
      const r2 = await processBillingEvent(baseEvent({ orgId: org2.orgId, status: "active" }), NOW);
      expect(r1).toBe("processed");
      expect(r2).toBe("processed");
      const sub1 = await prisma.subscription.findUniqueOrThrow({ where: { orgId: org.orgId } });
      const sub2 = await prisma.subscription.findUniqueOrThrow({ where: { orgId: org2.orgId } });
      expect(sub1.orgId).not.toBe(sub2.orgId);
    } finally {
      await purgeTestOrg(org2);
    }
  });

  it("trialing -> Organization.status=active, trialEndsAt preenchido", async () => {
    await processBillingEvent(baseEvent({ status: "trialing", currentPeriodEnd: null }), NOW);
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { orgId: org.orgId } });
    expect(sub.status).toBe("trialing");
    expect(sub.trialEndsAt).not.toBeNull();
    const o = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
    expect(o.status).toBe("active");
  });

  it("past_due recente -> Organization.status=active (dentro do grace de 7d)", async () => {
    await processBillingEvent(baseEvent({ status: "active" }), NOW);
    await processBillingEvent(baseEvent({ status: "past_due" }), NOW);
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { orgId: org.orgId } });
    expect(sub.status).toBe("past_due");
    expect(sub.pastDueSince).not.toBeNull();
    const o = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
    expect(o.status).toBe("active");
  });

  it("past_due fora do grace (evento processado 8 dias depois) -> Organization.status=suspended", async () => {
    await processBillingEvent(baseEvent({ status: "active" }), NOW);
    await processBillingEvent(baseEvent({ status: "past_due" }), NOW);
    const later = new Date(NOW.getTime() + 8 * 24 * 3600_000);
    // Evento subsequente do provedor confirmando que o past_due persiste (mesma assinatura, novo eventId) 8 dias depois.
    await processBillingEvent(baseEvent({ status: "past_due" }), later);
    const o = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
    expect(o.status).toBe("suspended");
  });

  it("payment.recovered (status volta a active) -> pastDueSince limpo, Organization.status=active", async () => {
    await processBillingEvent(baseEvent({ status: "active" }), NOW);
    await processBillingEvent(baseEvent({ status: "past_due" }), NOW);
    await processBillingEvent(baseEvent({ type: "payment.recovered", status: "active" }), NOW);
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { orgId: org.orgId } });
    expect(sub.status).toBe("active");
    expect(sub.pastDueSince).toBeNull();
    const o = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
    expect(o.status).toBe("active");
  });

  it("canceled -> soft-block imediato (Organization.status=suspended), canceledAt preenchido", async () => {
    await processBillingEvent(baseEvent({ status: "active" }), NOW);
    await processBillingEvent(baseEvent({ type: "subscription.canceled", status: "canceled" }), NOW);
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { orgId: org.orgId } });
    expect(sub.status).toBe("canceled");
    expect(sub.canceledAt).not.toBeNull();
    const o = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
    expect(o.status).toBe("suspended");
  });

  it("incomplete -> Organization.status=suspended", async () => {
    await processBillingEvent(baseEvent({ status: "incomplete" }), NOW);
    const o = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
    expect(o.status).toBe("suspended");
  });
});
