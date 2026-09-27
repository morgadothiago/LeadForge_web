import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { AppError } from "@/lib/errors";
import { MockPaymentProvider } from "./mock";

let org: TestOrg;
const provider = new MockPaymentProvider();

beforeAll(async () => {
  org = await createTestOrg("mock-provider");
});
afterEach(async () => {
  await prisma.subscription.deleteMany({ where: { orgId: org.orgId } });
  await prisma.webhookEvent.deleteMany({ where: { orgId: org.orgId } });
});
afterAll(() => purgeTestOrg(org));

describe("MockPaymentProvider (SPEC-033, D-33-5 - default sem conta/chaves externas)", () => {
  it("createCheckoutSession: marca Subscription active DIRETO, sem gateway externo, e devolve url com session_id", async () => {
    const r = await provider.createCheckoutSession({
      orgId: org.orgId,
      planKey: "starter",
      cadence: "monthly",
      customerEmail: "dono@example.com",
      successUrl: "http://app.test/assinatura?ok=1",
      cancelUrl: "http://app.test/assinatura?cancel=1",
    });
    expect(r.url).toContain("session_id=");
    expect(r.url).toContain("http://app.test/assinatura?ok=1");
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { orgId: org.orgId } });
    expect(sub.status).toBe("active");
    const o = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
    expect(o.status).toBe("active");
    // O evento foi persistido via o MESMO processBillingEvent do webhook real (idempotência real, não simulada).
    const event = await prisma.webhookEvent.findUnique({ where: { eventId: r.sessionId } });
    expect(event?.source).toBe("billing");
  });

  it("createCheckoutSession: plano 'business' (sem checkout self-service, D-33-2) é recusado", async () => {
    await expect(
      provider.createCheckoutSession({
        orgId: org.orgId,
        planKey: "business",
        cadence: "monthly",
        customerEmail: "dono@example.com",
        successUrl: "http://app.test/ok",
        cancelUrl: "http://app.test/cancel",
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("createCheckoutSession: plano inexistente é recusado", async () => {
    await expect(
      provider.createCheckoutSession({
        orgId: org.orgId,
        planKey: "plano-fantasma",
        cadence: "monthly",
        customerEmail: "dono@example.com",
        successUrl: "http://app.test/ok",
        cancelUrl: "http://app.test/cancel",
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("createPortalSession: devolve url baseada em returnUrl, sem tocar no banco", async () => {
    const r = await provider.createPortalSession({ orgId: org.orgId, returnUrl: "http://app.test/assinatura" });
    expect(r.url).toContain("http://app.test/assinatura");
    expect(r.url).toContain("portal=mock");
  });

  it("verifyWebhookSignature: sempre true em modo mock", () => {
    expect(provider.verifyWebhookSignature("qualquer coisa", null)).toBe(true);
  });

  it("parseWebhookEvent: JSON inválido lança AppError(validation)", () => {
    expect(() => provider.parseWebhookEvent("{ nao é json")).toThrow(AppError);
  });
});
