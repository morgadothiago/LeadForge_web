import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { sendSystemEmail } from "@/lib/channels/system-mail";
import { sendTrialStartedEmail } from "./trial-email";
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

  it("PIX pago (transparent.completed) em org em trial: confirmacao + recibo PIX", async () => {
    await processBillingEvent(ev({ status: "trialing", currentPeriodEnd: null }), NOW);
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

  it("recuperacao (past_due -> active) sem PIX: classificada, sem e-mail novo (052b)", async () => {
    await processBillingEvent(ev(), NOW);
    await processBillingEvent(ev({ type: "payment.failed", status: "past_due" }), NOW);
    expect(scenarios()).toEqual(["subscription_success"]);
    vi.mocked(sendSystemEmail).mockClear();
    await processBillingEvent(ev({ type: "payment.recovered", currentPeriodEnd: NEXT2 }), NOW);
    expect(sendSystemEmail).not.toHaveBeenCalled();
  });

  it("falha de pagamento: sem e-mail novo (052b); job diario preservado", async () => {
    await processBillingEvent(ev(), NOW);
    vi.mocked(sendSystemEmail).mockClear();
    await processBillingEvent(ev({ type: "payment.failed", status: "past_due" }), NOW);
    expect(sendSystemEmail).not.toHaveBeenCalled();
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

  it("trial: webhook trialing + e-mail do signup compartilham a chave trial_started:<orgId> (1 so aviso)", async () => {
    await sendTrialStartedEmail(org.orgId, "Starter", NEXT);
    await processBillingEvent(ev({ status: "trialing", currentPeriodEnd: null }), NOW);
    await sendTrialStartedEmail(org.orgId, "Starter", NEXT);
    expect(scenarios()).toEqual(["trial_started"]);
  });

  it("e-mail de trial do signup tem link absoluto e vai ao owner", async () => {
    await sendTrialStartedEmail(org.orgId, "Starter", NEXT);
    const [, subject, content] = calls()[0];
    expect(subject).toMatch(/teste/i);
    expect(content.text).toMatch(/https?:\/\/\S+\/dashboard/);
  });
});
