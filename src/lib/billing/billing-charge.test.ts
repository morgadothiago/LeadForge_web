import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { sendSystemEmail } from "@/lib/channels/system-mail";
import type { ParsedBillingEvent } from "./provider";
import { processBillingEvent } from "./process-event";
import { canTransition, normalizeChargeId, safeReceiptUrl } from "./billing-charge";
import { AbacatePayPaymentProvider } from "./providers/abacatepay";
import { fakeAbacateApi } from "./providers/abacatepay.test-helper";
import { keyFingerprintOf } from "./providers/abacatepay-catalog";
import renewedCard from "./providers/__fixtures__/abacatepay/subscription-renewed-card.json";
import paymentFailed from "./providers/__fixtures__/abacatepay/subscription-payment-failed.json";
import transparentPix from "./providers/__fixtures__/abacatepay/transparent-completed-pix.json";

/** SPEC-066a — webhook/job -> `BillingCharge` (idempotencia, monotonia, convergencia falha->pago, ancora de vencimento Q-066-1). */
vi.mock("@/lib/channels/system-mail", () => ({ sendSystemEmail: vi.fn(async () => ({ ok: true, messageId: "" })) }));

let org: TestOrg;
let other: TestOrg;
const T0 = new Date("2026-03-01T12:00:00Z");
const T1 = new Date("2026-04-01T12:00:00Z"); // ciclos de calendario (ancora 01/03)
const T2 = new Date("2026-05-01T12:00:00Z");
const NOW = T0;

const ev = (over: Partial<ParsedBillingEvent> = {}): ParsedBillingEvent => ({
  eventId: `zz-evt-066a-${randomUUID()}`, type: "subscription.created", orgId: org.orgId, planKey: "starter", cadence: "monthly", status: "active",
  currentPeriodEnd: T1, cancelAtPeriodEnd: false, externalCustomerId: "cus_1", externalSubscriptionId: "sub_1",
  provider: "abacatepay", paymentMethod: "card", amountCents: 2990, externalPaymentId: "char_1", paidAt: T0, ...over,
});
const charges = (orgId = org.orgId) => prisma.billingCharge.findMany({ where: { orgId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

beforeAll(async () => {
  org = await createTestOrg("billing-charge");
  other = await createTestOrg("billing-charge-other");
});
beforeEach(() => vi.mocked(sendSystemEmail).mockClear());
afterEach(async () => {
  for (const o of [org, other]) {
    await prisma.billingCharge.deleteMany({ where: { orgId: o.orgId } });
    await prisma.subscription.deleteMany({ where: { orgId: o.orgId } });
    await prisma.webhookEvent.deleteMany({ where: { orgId: o.orgId } });
    await prisma.emailDispatchLog.deleteMany({ where: { orgId: o.orgId } });
  }
});
afterAll(async () => {
  await purgeTestOrg(org);
  await purgeTestOrg(other);
});

describe("helpers puros", () => {
  it("safeReceiptUrl so aceita https de abacatepay.com", () => {
    expect(safeReceiptUrl("https://app.abacatepay.com/receipt/abc")).toMatch(/^https:\/\/app\.abacatepay\.com/);
    expect(safeReceiptUrl("http://app.abacatepay.com/r")).toBeNull();
    expect(safeReceiptUrl("https://evil.com/abacatepay.com")).toBeNull();
    expect(safeReceiptUrl("https://abacatepay.com.evil.com/x")).toBeNull();
    expect(safeReceiptUrl("javascript:alert(1)")).toBeNull();
    expect(safeReceiptUrl(null)).toBeNull();
  });
  it("normalizeChargeId tira pix_ so do PIX", () => {
    expect(normalizeChargeId("pix_char_1", "pix")).toBe("char_1");
    expect(normalizeChargeId("char_1", "pix")).toBe("char_1");
    expect(normalizeChargeId("pix_x", "card")).toBe("pix_x");
    expect(normalizeChargeId(null, "card")).toBeNull();
  });
  it("monotonia: paid/refunded/canceled nunca regridem", () => {
    expect(canTransition("paid", "pending")).toBe(false);
    expect(canTransition("paid", "failed")).toBe(false);
    expect(canTransition("paid", "refunded")).toBe(true);
    expect(canTransition("canceled", "paid")).toBe(false);
    expect(canTransition("refunded", "paid")).toBe(false);
    expect(canTransition("failed", "paid")).toBe(true);
    expect(canTransition("pending", "failed")).toBe(true);
  });
});

describe("pagamento de cartao -> BillingCharge paid", () => {
  it("1o pagamento cria 1 linha paid: valor, paidAt, metodo, receipt valido, vencimento = data do pagamento", async () => {
    await processBillingEvent(ev({ cardLast4: "4242", cardBrand: "VISA", receiptUrl: "https://app.abacatepay.com/receipt/x" }), NOW);
    const rows = await charges();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "abacatepay", externalId: "char_1", status: "paid", method: "card", amountCents: 2990, cardLast4: "4242", cardBrand: "VISA", planKey: "starter", cadence: "monthly", subscriptionId: "sub_1" });
    expect(rows[0]!.paidAt).toEqual(T0);
    expect(rows[0]!.dueAt).toEqual(T0);
    expect(rows[0]!.periodStart).toEqual(T0);
    expect(rows[0]!.periodEnd).toEqual(T1);
    expect(rows[0]!.receiptUrl).toMatch(/abacatepay\.com/);
  });

  it("receiptUrl fora do dominio e cardLast4 invalido nao sao gravados", async () => {
    await processBillingEvent(ev({ cardLast4: "4242-9999-1111", receiptUrl: "https://evil.example/r" }), NOW);
    const [row] = await charges();
    expect(row!.receiptUrl).toBeNull();
    expect(row!.cardLast4).toBeNull();
  });

  it("reenvio: mesmo eventId (duplicate) e mesmo pagamento com outro eventId nao duplicam", async () => {
    const e = ev();
    expect(await processBillingEvent(e, NOW)).toBe("processed");
    expect(await processBillingEvent(e, NOW)).toBe("duplicate");
    await processBillingEvent(ev({ type: "subscription.updated", currentPeriodEnd: T2 }), NOW); // outro eventId, mesmo externalPaymentId
    expect(await charges()).toHaveLength(1);
  });

  it("renovacao: nova linha com vencimento ancorado no fim do periodo anterior (mensal)", async () => {
    await processBillingEvent(ev(), NOW);
    await processBillingEvent(ev({ type: "subscription.updated", externalPaymentId: "char_2", currentPeriodEnd: T2, paidAt: T1 }), T1);
    const rows = await charges();
    expect(rows).toHaveLength(2);
    const second = rows.find((r) => r.externalId === "char_2")!;
    expect(second.dueAt).toEqual(T1);
    expect(second.periodStart).toEqual(T1);
    expect(second.periodEnd).toEqual(T2);
  });

  it("anual: ancora na data do 1o pagamento (vence 1 ano depois)", async () => {
    const Y1 = new Date("2027-03-01T12:00:00Z");
    const Y2 = new Date("2028-03-01T12:00:00Z");
    await processBillingEvent(ev({ cadence: "yearly", currentPeriodEnd: Y1, amountCents: 29900 }), NOW);
    await processBillingEvent(ev({ cadence: "yearly", type: "subscription.updated", externalPaymentId: "char_y2", currentPeriodEnd: Y2, paidAt: Y1, amountCents: 29900 }), Y1);
    const rows = await charges();
    expect(rows.map((r) => r.dueAt?.toISOString())).toEqual([NOW.toISOString(), Y1.toISOString()]);
    expect(rows.every((r) => r.cadence === "yearly")).toBe(true);
  });

  it("sem amountCents (mock) cai no preco do plano x cadencia", async () => {
    await processBillingEvent(ev({ amountCents: null, provider: "mock" }), NOW);
    const plan = await prisma.plan.findUniqueOrThrow({ where: { key: "starter" } });
    expect((await charges())[0]).toMatchObject({ provider: "mock", amountCents: plan.priceMonthlyCents });
  });

  it("evento sem externalPaymentId (confirmacao/mudanca) nao grava cobranca e o resto do evento segue", async () => {
    await processBillingEvent(ev({ externalPaymentId: null, paidAt: null }), NOW);
    expect(await charges()).toHaveLength(0);
    expect((await prisma.subscription.findUnique({ where: { orgId: org.orgId } }))?.status).toBe("active");
  });
});

describe("falha de cartao", () => {
  const failed = (over: Partial<ParsedBillingEvent> = {}) =>
    ev({ type: "payment.failed", status: "past_due", currentPeriodEnd: T1, externalPaymentId: null, paidAt: null, installmentId: "intl_1", retryNumber: 1, ...over });

  beforeEach(async () => {
    await processBillingEvent(ev(), NOW); // 1o pagamento (ancora T1)
  });

  it("cria 1 linha failed (vencimento = fim do periodo anterior) e as retentativas ATUALIZAM a mesma linha", async () => {
    await processBillingEvent(failed(), T1);
    await processBillingEvent(failed({ retryNumber: 2 }), T1);
    await processBillingEvent(failed({ retryNumber: 1 }), T1); // fora de ordem: nao reduz
    const rows = (await charges()).filter((r) => r.status === "failed");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ externalId: "intl_1", retryCount: 2, failureReason: null, amountCents: 2990 });
    expect(rows[0]!.dueAt).toEqual(T1);
    expect(rows[0]!.periodEnd).toEqual(T2);
  });

  it("falha seguida de pagamento (renewed sem installmentId) converge na MESMA linha, que fica paid", async () => {
    await processBillingEvent(failed(), T1);
    const lateT = new Date("2026-04-02T12:00:00Z");
    await processBillingEvent(ev({ type: "subscription.updated", externalPaymentId: "char_late", currentPeriodEnd: new Date("2026-05-02T12:00:00Z"), paidAt: lateT, receiptUrl: "https://app.abacatepay.com/receipt/z" }), lateT);
    const rows = await charges();
    expect(rows).toHaveLength(2); // 1o pagamento + a parcela que falhou e foi paga
    const converged = rows.find((r) => r.externalId === "intl_1")!;
    expect(converged).toMatchObject({ status: "paid", paidAt: lateT, retryCount: 1 });
    expect(converged.dueAt).toEqual(T1);
    expect(converged.receiptUrl).toMatch(/abacatepay/);
  });

  it("falha FORA DE ORDEM depois de paga: a linha paid nao regride", async () => {
    await processBillingEvent(failed(), T1);
    await processBillingEvent(ev({ type: "subscription.updated", externalPaymentId: "char_late", currentPeriodEnd: T2, paidAt: T1 }), T1);
    await processBillingEvent(failed({ retryNumber: 3 }), T1);
    const converged = (await charges()).find((r) => r.externalId === "intl_1")!;
    expect(converged.status).toBe("paid");
  });

  it("falha sem installmentId nao grava cobranca e nao quebra o evento", async () => {
    await processBillingEvent(failed({ installmentId: null }), T1);
    expect((await charges()).filter((r) => r.status === "failed")).toHaveLength(0);
    expect((await prisma.subscription.findUnique({ where: { orgId: org.orgId } }))?.status).toBe("past_due");
  });

  it("cancelamento: pendentes viram canceled; paid e failed ficam", async () => {
    await processBillingEvent(failed(), T1);
    await prisma.billingCharge.create({ data: { orgId: org.orgId, provider: "abacatepay", externalId: "char_pend", amountCents: 2990, status: "pending", method: "pix", planKey: "starter", cadence: "monthly" } });
    await processBillingEvent(ev({ type: "subscription.canceled", status: "canceled", externalPaymentId: null, paidAt: null, amountCents: null }), T1);
    const byId = Object.fromEntries((await charges()).map((r) => [r.externalId, r.status]));
    expect(byId).toMatchObject({ char_1: "paid", intl_1: "failed", char_pend: "canceled" });
  });
});

describe("PIX", () => {
  const pending = (externalId = "char_pix1") =>
    prisma.billingCharge.create({ data: { orgId: org.orgId, provider: "abacatepay", externalId, amountCents: 2990, status: "pending", method: "pix", planKey: "starter", cadence: "monthly", dueAt: T0, periodStart: T0, periodEnd: T1 } });
  const pixPaid = (over: Partial<ParsedBillingEvent> = {}) =>
    ev({ type: "subscription.updated", paymentMethod: "pix", externalPaymentId: "char_pix1", cardLast4: null, cardBrand: null, ...over });

  it("pagamento PIX promove a linha pending (id com ou sem prefixo pix_) e nao duplica", async () => {
    await pending();
    await processBillingEvent(pixPaid({ externalPaymentId: "pix_char_pix1", receiptUrl: "https://app.abacatepay.com/receipt/p" }), T0);
    const rows = await charges();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "paid", method: "pix", externalId: "char_pix1", cardLast4: null });
    await processBillingEvent(pixPaid({ currentPeriodEnd: T2 }), T0); // reenvio com outro eventId
    expect(await charges()).toHaveLength(1);
  });

  it("PIX expirado: pending -> failed; pagamento tardio -> paid; falha depois de paga nao regride", async () => {
    await pending();
    const expired = (): ParsedBillingEvent => ev({ type: "payment.failed", status: "past_due", paymentMethod: "pix", installmentId: "char_pix1", externalPaymentId: null, paidAt: null, amountCents: null });
    await processBillingEvent(expired(), T1);
    expect((await charges())[0]!.status).toBe("failed");
    await processBillingEvent(pixPaid({ currentPeriodEnd: T2 }), T1);
    expect((await charges())[0]!.status).toBe("paid");
    await processBillingEvent(expired(), T1);
    const rows = await charges();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("paid");
  });

  it("PIX pago sem linha pendente previa cria linha paid", async () => {
    await processBillingEvent(pixPaid(), T0);
    expect((await charges())[0]).toMatchObject({ status: "paid", method: "pix", externalId: "char_pix1" });
  });
});

describe("pos-QA: ancora sem deriva, dedupe e id de outra org", () => {
  it("A1: 4 renovacoes encadeadas (currentPeriodEnd do provedor derivando 28) gravam vencimentos ancorados no dia 31", async () => {
    const P0 = new Date("2026-01-31T15:00:00Z");
    await processBillingEvent(ev({ paidAt: P0, currentPeriodEnd: new Date("2026-02-28T15:00:00Z") }), P0);
    // o provedor/parser encadeia addCycle: 28/02 -> 28/03 -> 28/04 -> 28/05
    const chain = ["2026-03-28", "2026-04-28", "2026-05-28"].map((d) => new Date(`${d}T15:00:00Z`));
    let prev = new Date("2026-02-28T15:00:00Z");
    for (const [i, end] of chain.entries()) {
      await processBillingEvent(ev({ type: "subscription.updated", externalPaymentId: `char_r${i}`, paidAt: prev, currentPeriodEnd: end }), prev);
      prev = end;
    }
    const rows = await prisma.billingCharge.findMany({ where: { orgId: org.orgId }, orderBy: { paidAt: "asc" } });
    expect(rows.map((r) => r.dueAt!.toISOString().slice(0, 10))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(rows.map((r) => r.periodEnd!.toISOString().slice(0, 10))).toEqual(["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  });

  it("B2: falha convertida em pago + MESMO pagamento com outro eventId nao cria 2a linha paga", async () => {
    await processBillingEvent(ev(), NOW);
    const failed = ev({ type: "payment.failed", status: "past_due", currentPeriodEnd: T1, externalPaymentId: null, paidAt: null, installmentId: "intl_dd", retryNumber: 1 });
    await processBillingEvent(failed, T1);
    const late = new Date("2026-04-02T12:00:00Z");
    const pay = () => ev({ type: "subscription.updated", externalPaymentId: "char_dd", currentPeriodEnd: new Date("2026-05-02T12:00:00Z"), paidAt: late });
    await processBillingEvent(pay(), late);
    await processBillingEvent(pay(), late); // outro eventId, mesmo pagamento
    const rows = await charges();
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.status === "paid")).toHaveLength(2);
  });

  it("B4: (provider, externalId) de OUTRA org e ignorado, sem tocar na linha alheia", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await prisma.billingCharge.create({ data: { orgId: other.orgId, provider: "abacatepay", externalId: "char_foreign", amountCents: 100, status: "pending", method: "pix", planKey: "starter", cadence: "monthly" } });
    await prisma.billingCharge.create({ data: { orgId: other.orgId, provider: "abacatepay", externalId: "intl_foreign", amountCents: 100, status: "pending", method: "card", planKey: "starter", cadence: "monthly" } });
    await processBillingEvent(ev({ paymentMethod: "pix", externalPaymentId: "char_foreign" }), NOW);
    await processBillingEvent(ev({ type: "payment.failed", status: "past_due", externalPaymentId: null, paidAt: null, installmentId: "intl_foreign" }), NOW);
    const foreign = await charges(other.orgId);
    expect(foreign.map((r) => r.status)).toEqual(["pending", "pending"]);
    expect(await charges(org.orgId)).toHaveLength(0);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("OUTRA organizacao"));
    expect(err.mock.calls.flat().join(" ")).not.toMatch(/char_foreign|intl_foreign/);
    err.mockRestore();
  });
});

describe("isolamento entre organizacoes", () => {
  it("pagamentos de A e B (mesmo id de pagamento) ficam cada um na sua org por provider+externalId unico: a 2a nao sobrescreve a 1a", async () => {
    await processBillingEvent(ev({ externalPaymentId: "char_shared" }), NOW);
    await processBillingEvent(ev({ orgId: other.orgId, externalPaymentId: "char_unique_b" }), NOW);
    expect(await charges(org.orgId)).toHaveLength(1);
    expect(await charges(other.orgId)).toHaveLength(1);
  });
});

describe("fixtures reais do AbacatePay -> parser -> processBillingEvent", () => {
  const API_KEY = "test-abacatepay-api-key-066a";
  const mk = () => new AbacatePayPaymentProvider({ apiKey: API_KEY, webhookSecret: "test-abacatepay-webhook-secret-32chars-min", adapter: fakeAbacateApi().adapter, retry: false, clock: () => NOW, errorLog: () => undefined });
  const SUBS = "subs_tAFqDWBhcEYTjQh2K0ZYDHau";
  const parse = (body: unknown) => mk().parseWebhookEvent(JSON.stringify(body)) as Promise<ParsedBillingEvent | null>;
  let starterId: string;
  beforeEach(async () => {
    starterId = (await prisma.plan.findUniqueOrThrow({ where: { key: "starter" } })).id;
    await prisma.billingProduct.deleteMany({ where: { keyFingerprint: keyFingerprintOf(API_KEY) } });
    await prisma.subscription.create({ data: { orgId: org.orgId, planId: starterId, status: "active", cadence: "monthly", externalSubscriptionId: SUBS, currentPeriodEnd: T0 } });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("subscription.renewed -> 1 linha paid com valor/recibo/ultimos 4 (nunca o numero)", async () => {
    const e = (await parse(renewedCard))!;
    expect(e.provider).toBe("abacatepay");
    await processBillingEvent(e, NOW);
    const rows = await charges();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ externalId: "char_xyz789", status: "paid", amountCents: 2990, method: "card" });
    expect(rows[0]!.receiptUrl).toMatch(/^https:\/\/app\.abacatepay\.com/);
    expect(JSON.stringify(rows[0])).not.toMatch(/\d{12,}/);
  });

  it("subscription.payment_failed -> 1 linha failed (intl_...); o mesmo evento nao duplica", async () => {
    const e = (await parse(paymentFailed))!;
    expect(e.installmentId).toBe("intl_abc123xyz");
    expect(e.retryNumber).toBe(1);
    await processBillingEvent(e, NOW);
    expect(await processBillingEvent(e, NOW)).toBe("duplicate");
    const rows = await charges();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ externalId: "intl_abc123xyz", status: "failed", amountCents: 2990, retryCount: 1 });
  });

  it("transparent.completed (PIX) -> 1 linha paid pix", async () => {
    await prisma.subscription.update({ where: { orgId: org.orgId }, data: { pixManaged: true, pixChargeId: "pix_char_xyz789" } });
    const e = (await parse(transparentPix))!;
    await processBillingEvent(e, NOW);
    const rows = await charges();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ externalId: "char_xyz789", status: "paid", method: "pix", amountCents: 5000, subscriptionId: null });
  });
});
