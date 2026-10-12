import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { sendSystemEmail } from "@/lib/channels/system-mail";
import type { ParsedBillingEvent } from "./provider";
import { processBillingEvent } from "./process-event";

/** SPEC-052a — classificacao do evento -> e-mail correto (recibo x confirmacao), idempotencia e best-effort. sendSystemEmail mockado. */
vi.mock("@/lib/channels/system-mail", () => ({ sendSystemEmail: vi.fn(async () => ({ ok: true, messageId: "" })) }));

let org: TestOrg;
const NOW = new Date("2026-03-01T12:00:00Z");
const NEXT = new Date("2026-03-31T12:00:00Z");
const NEXT2 = new Date("2026-04-30T12:00:00Z");

const ev = (over: Partial<ParsedBillingEvent> = {}): ParsedBillingEvent => ({
  eventId: `zz-evt-052a-${randomUUID()}`, type: "subscription.created", orgId: org.orgId, planKey: "starter", cadence: "monthly", status: "active",
  currentPeriodEnd: NEXT, cancelAtPeriodEnd: false, externalCustomerId: "cus_1", externalSubscriptionId: "sub_1", ...over,
});
const calls = () => vi.mocked(sendSystemEmail).mock.calls;
const scenarios = () => calls().map((c) => c[3]);

beforeAll(async () => {
  org = await createTestOrg("process-event-052a");
});
beforeEach(() => vi.mocked(sendSystemEmail).mockClear());
afterEach(async () => {
  await prisma.subscription.deleteMany({ where: { orgId: org.orgId } });
  await prisma.webhookEvent.deleteMany({ where: { orgId: org.orgId } });
  await prisma.emailDispatchLog.deleteMany({ where: { orgId: org.orgId } });
});
afterAll(() => purgeTestOrg(org));

describe("processBillingEvent — classificacao e e-mail (SPEC-052a)", () => {
  it("1a ativacao envia 1 confirmacao (subscription_success) e nenhum recibo (cartao)", async () => {
    await processBillingEvent(ev(), NOW);
    expect(scenarios()).toEqual(["subscription_success"]);
  });

  it("renovacao de cartao (subscription.renewed) envia 1 RECIBO e nao 'Assinatura confirmada'; so os 4 digitos; valor do provedor", async () => {
    await processBillingEvent(ev(), NOW);
    vi.mocked(sendSystemEmail).mockClear();
    await processBillingEvent(
      ev({ type: "subscription.updated", currentPeriodEnd: NEXT2, amountCents: 12_345, paymentMethod: "card", cardLast4: "4242", externalPaymentId: "pay_9", paidAt: NEXT }),
      NOW,
    );
    expect(scenarios()).toEqual(["payment_receipt"]);
    const [, subject, content] = calls()[0];
    expect(subject).toMatch(/Recibo/);
    expect(content.text).toContain("123,45");
    expect(content.text).toContain("final 4242");
    expect(content.text).toContain("pay_9");
    expect(content.text).toMatch(/não é nota fiscal/);
    expect(content.text).not.toMatch(/Assinatura confirmada/);
  });

  it("recibo sem amountCents cai no preco do plano (D-052-3)", async () => {
    await processBillingEvent(ev(), NOW);
    vi.mocked(sendSystemEmail).mockClear();
    await processBillingEvent(ev({ type: "subscription.updated", currentPeriodEnd: NEXT2 }), NOW);
    expect(scenarios()).toEqual(["payment_receipt"]);
    const plan = await prisma.plan.findUniqueOrThrow({ where: { key: "starter" }, select: { priceMonthlyCents: true } });
    const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format((plan.priceMonthlyCents ?? 0) / 100);
    expect(calls()[0][2].text).toContain(brl.replace(/ /g, " ").slice(2).trim().slice(0, 3));
  });

  it("PIX pago (transparent.completed) em org ainda nao ativa (incomplete): confirmacao + recibo PIX", async () => {
    await processBillingEvent(ev({ status: "incomplete", currentPeriodEnd: null }), NOW);
    vi.mocked(sendSystemEmail).mockClear();
    await processBillingEvent(ev({ type: "subscription.updated", paymentMethod: "pix", amountCents: 9900, externalPaymentId: "pix_1" }), NOW);
    expect(scenarios().sort()).toEqual(["payment_receipt", "subscription_success"]);
    expect(calls().find((c) => c[3] === "payment_receipt")![2].text).toContain("PIX");
  });

  it("PIX pago renovando org ativa: 1 recibo e nenhuma confirmacao", async () => {
    await processBillingEvent(ev(), NOW);
    vi.mocked(sendSystemEmail).mockClear();
    await processBillingEvent(ev({ type: "subscription.updated", currentPeriodEnd: NEXT2, paymentMethod: "pix", amountCents: 9900 }), NOW);
    expect(scenarios()).toEqual(["payment_receipt"]);
  });

  it("recuperacao (past_due -> active) sem PIX: envia payment_recovered (052b), sem recibo", async () => {
    await processBillingEvent(ev(), NOW);
    await processBillingEvent(ev({ type: "payment.failed", status: "past_due" }), NOW);
    expect(scenarios()).toEqual(["subscription_success", "payment_failed"]);
    vi.mocked(sendSystemEmail).mockClear();
    await processBillingEvent(ev({ type: "payment.recovered", currentPeriodEnd: NEXT2 }), NOW);
    expect(scenarios()).toEqual(["payment_recovered"]);
  });

  it("falha de pagamento: envia payment_failed imediato (052b)", async () => {
    await processBillingEvent(ev(), NOW);
    vi.mocked(sendSystemEmail).mockClear();
    await processBillingEvent(ev({ type: "payment.failed", status: "past_due" }), NOW);
    expect(scenarios()).toEqual(["payment_failed"]);
  });

  it("reentrega do mesmo evento nao duplica recibo", async () => {
    await processBillingEvent(ev(), NOW);
    vi.mocked(sendSystemEmail).mockClear();
    const renewed = ev({ type: "subscription.updated", currentPeriodEnd: NEXT2 });
    expect(await processBillingEvent(renewed, NOW)).toBe("processed");
    expect(await processBillingEvent(renewed, NOW)).toBe("duplicate");
    expect(scenarios()).toEqual(["payment_receipt"]);
  });

  it("falha do provider no recibo nao propaga e nao reverte a transacao", async () => {
    await processBillingEvent(ev(), NOW);
    vi.mocked(sendSystemEmail).mockRejectedValueOnce(new Error("smtp down"));
    expect(await processBillingEvent(ev({ type: "subscription.updated", currentPeriodEnd: NEXT2 }), NOW)).toBe("processed");
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { orgId: org.orgId }, select: { currentPeriodEnd: true } });
    expect(sub.currentPeriodEnd).toEqual(NEXT2);
  });

  it("SPEC-062: evento externo `trialing` e noop de e-mail (sem trial_started) e NAO calcula trialEndsAt (+14d)", async () => {
    await processBillingEvent(ev({ status: "trialing", currentPeriodEnd: null }), NOW);
    expect(scenarios()).toEqual([]);
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { orgId: org.orgId }, select: { trialEndsAt: true, status: true } });
    expect(sub.trialEndsAt).toBeNull();
    expect(sub.status).toBe("trialing");
  });

  it("SPEC-065 (D-065-9, substitui a regra da 062): ao ATIVAR (pagar) o trial acaba — trialEndsAt vira null; so e preservado em status nao-active", async () => {
    const legacy = new Date("2026-03-10T00:00:00Z");
    await prisma.subscription.create({ data: { orgId: org.orgId, planId: (await prisma.plan.findUniqueOrThrow({ where: { key: "starter" } })).id, status: "trialing", trialEndsAt: legacy } });
    await processBillingEvent(ev(), NOW);
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { orgId: org.orgId }, select: { trialEndsAt: true, status: true } });
    expect(sub.status).toBe("active");
    expect(sub.trialEndsAt).toBeNull();
    expect(scenarios()).toEqual(["subscription_success"]);
  });
});
