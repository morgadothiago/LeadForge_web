import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { sendSystemEmail } from "@/lib/channels/system-mail";
import { AppError } from "@/lib/errors";
import { handleBillingWebhook } from "../webhook-handler";
import { AbacatePayPaymentProvider } from "./abacatepay";
import { addCycle, orgIdFromExternalId } from "./abacatepay-webhook";
import { keyFingerprintOf } from "./abacatepay-catalog";
import { fakeAbacateApi, type FakeApi } from "./abacatepay.test-helper";
import completedCard from "./__fixtures__/abacatepay/subscription-completed-card.json";
import completedPix from "./__fixtures__/abacatepay/subscription-completed-pix.json";
import renewedCard from "./__fixtures__/abacatepay/subscription-renewed-card.json";
import paymentFailed from "./__fixtures__/abacatepay/subscription-payment-failed.json";
import cancelledManual from "./__fixtures__/abacatepay/subscription-cancelled-manual.json";
import cancelledMaxRetries from "./__fixtures__/abacatepay/subscription-cancelled-max-retries.json";
import trialStarted from "./__fixtures__/abacatepay/subscription-trial-started.json";
import transparentPix from "./__fixtures__/abacatepay/transparent-completed-pix.json";
import checkoutCompleted from "./__fixtures__/abacatepay/checkout-completed-card.json";

/**
 * SPEC-063 — webhook v2. Fixtures copiadas LITERALMENTE da doc oficial (docs.abacatepay.com/pages/webhooks/events/*, 2026-10-11).
 * Ids da doc: subs_tAFqDWBhcEYTjQh2K0ZYDHau, bill_jskd3TMfScHZDJe5NSZjTmQ4 (renewed: bill_renewxyz789), prod_bx4BstRWhQ2SUcKsPt4c6pmq, char_xyz789.
 */
vi.mock("@/lib/channels/system-mail", () => ({ sendSystemEmail: vi.fn(async () => ({ ok: true, messageId: "" })) }));

const API_KEY = "test-abacatepay-api-key-063-webhook";
const SECRET = "test-abacatepay-webhook-secret-32chars-min";
const FP = keyFingerprintOf(API_KEY);
const SUBS = "subs_tAFqDWBhcEYTjQh2K0ZYDHau";
const BILL = "bill_jskd3TMfScHZDJe5NSZjTmQ4";
const PROD = "prod_bx4BstRWhQ2SUcKsPt4c6pmq";
const NOW = new Date("2026-09-27T12:00:00Z");

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
/** Copia o fixture trocando valores em caminhos "a.b.c" (o fixture literal da doc tem `externalId: null`, tipo estreito demais para atribuir). */
function edit(fx: unknown, changes: Record<string, unknown>): Record<string, unknown> {
  const out = clone(fx) as Record<string, unknown>;
  for (const [path, value] of Object.entries(changes)) {
    const keys = path.split(".");
    let cur = out;
    for (const k of keys.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
    cur[keys[keys.length - 1]!] = value;
  }
  return out;
}
let org: TestOrg;
let other: TestOrg;
let starterId: string;
let proId: string;
let warn: ReturnType<typeof vi.spyOn>;
let err: ReturnType<typeof vi.spyOn>;

function mk(api: FakeApi = fakeAbacateApi(), clock: () => Date = () => NOW) {
  return new AbacatePayPaymentProvider({ apiKey: API_KEY, webhookSecret: SECRET, adapter: api.adapter, retry: false, clock, errorLog: () => undefined });
}
const parse = (p: AbacatePayPaymentProvider, body: unknown) => p.parseWebhookEvent(JSON.stringify(body)) as Promise<import("../provider").ParsedBillingEvent | null>;
const mkSub = (data: Partial<Parameters<typeof prisma.subscription.create>[0]["data"]> = {}) =>
  prisma.subscription.create({ data: { orgId: org.orgId, planId: starterId, status: "incomplete", cadence: "monthly", ...data } as never });

beforeAll(async () => {
  org = await createTestOrg("abacatepay-webhook");
  other = await createTestOrg("abacatepay-webhook-other");
  starterId = (await prisma.plan.findUniqueOrThrow({ where: { key: "starter" } })).id;
  proId = (await prisma.plan.findUniqueOrThrow({ where: { key: "pro" } })).id;
});
beforeEach(async () => {
  vi.mocked(sendSystemEmail).mockClear();
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  err = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await prisma.billingProduct.create({ data: { provider: "abacatepay", keyFingerprint: FP, planId: starterId, cadence: "monthly", priceCents: 2990, externalId: "lf-starter-monthly-2990", providerProductId: PROD, devMode: true } });
});
afterEach(async () => {
  warn.mockRestore();
  err.mockRestore();
  for (const o of [org, other]) {
    await prisma.subscription.deleteMany({ where: { orgId: o.orgId } });
    await prisma.webhookEvent.deleteMany({ where: { orgId: o.orgId } });
    await prisma.emailDispatchLog.deleteMany({ where: { orgId: o.orgId } });
  }
  await prisma.billingProduct.deleteMany({ where: { keyFingerprint: FP } });
});
afterAll(async () => {
  await purgeTestOrg(org);
  await purgeTestOrg(other);
});

describe("addCycle (D-063-15: mes/ano de calendario, UTC)", () => {
  it("31/jan + 1 mes = 28/fev (29 em bissexto); 29/fev bissexto + 1 ano = 28/fev; preserva a hora", () => {
    expect(addCycle(new Date("2027-01-31T10:20:30Z"), "monthly").toISOString()).toBe("2027-02-28T10:20:30.000Z");
    expect(addCycle(new Date("2028-01-31T00:00:00Z"), "monthly").toISOString()).toBe("2028-02-29T00:00:00.000Z");
    expect(addCycle(new Date("2028-02-29T00:00:00Z"), "yearly").toISOString()).toBe("2029-02-28T00:00:00.000Z");
    expect(addCycle(new Date("2026-12-15T00:00:00Z"), "monthly").toISOString()).toBe("2027-01-15T00:00:00.000Z");
  });
  it("orgIdFromExternalId: so o prefixo certo; sem prefixo/vazio = null", () => {
    expect(orgIdFromExternalId("lf:abc-123:deadbeef", "lf")).toBe("abc-123");
    expect(orgIdFromExternalId("lf-pix:abc-123:1:dead", "lf-pix")).toBe("abc-123");
    expect(orgIdFromExternalId("lf-pix:abc:1", "lf")).toBeNull();
    expect(orgIdFromExternalId("pedido-456", "lf")).toBeNull();
    expect(orgIdFromExternalId(null, "lf")).toBeNull();
  });
});

describe("parseWebhookEvent — mapeamento dos eventos (fixtures da doc)", () => {
  it("subscription.completed (CARTAO): ativa; plano/cadencia pelo produto (reverso), recibo com valor, payment.id, 4 ultimos digitos e bandeira; correlaciona por checkout.id (bill_)", async () => {
    await mkSub({ externalCheckoutId: BILL });
    const evt = await parse(mk(), completedCard);
    expect(evt).toEqual({
      eventId: "log_taQArRTApemxwcbw5EJeF3hS", type: "subscription.created", orgId: org.orgId, planKey: "starter", cadence: "monthly", status: "active",
      currentPeriodEnd: new Date("2026-10-27T12:00:00Z"), // data 2024 da fixture e antiga -> base = "agora" (clock); +1 mes de calendario
      cancelAtPeriodEnd: false, externalCustomerId: "cust_def456", externalSubscriptionId: SUBS,
      amountCents: 2990, paymentMethod: "card", cardLast4: "1234", cardBrand: "VISA", externalPaymentId: "char_xyz789", paidAt: NOW,
    });
  });

  it("subscription.completed usa a data de pagamento do provedor quando recente (<=2 dias)", async () => {
    await mkSub({ externalCheckoutId: BILL });
    const body = edit(completedCard, { "data.payment.updatedAt": "2026-09-27T09:00:00.000Z" });
    const evt = await parse(mk(), body);
    expect(evt?.paidAt).toEqual(new Date("2026-09-27T09:00:00Z"));
    expect(evt?.currentPeriodEnd).toEqual(new Date("2026-10-27T09:00:00Z"));
  });

  it("subscription.completed (PIX na doc): mesma ativacao, paymentMethod pix, sem 4 digitos", async () => {
    await mkSub({ externalCheckoutId: BILL });
    const evt = await parse(mk(), completedPix);
    expect(evt).toMatchObject({ type: "subscription.created", status: "active", paymentMethod: "pix", cardLast4: null, cardBrand: null, externalSubscriptionId: SUBS });
  });

  it("subscription.renewed: updated/active; periodo parte de max(fim anterior, pagamento); correlaciona por subs_ (checkout.id do renewed e OUTRO bill_)", async () => {
    await mkSub({ status: "active", externalSubscriptionId: SUBS, externalCheckoutId: BILL, currentPeriodEnd: new Date("2026-10-05T00:00:00Z") });
    const evt = await parse(mk(), renewedCard);
    expect(evt).toMatchObject({
      eventId: "log_abc123xyz", type: "subscription.updated", orgId: org.orgId, status: "active", externalSubscriptionId: SUBS, amountCents: 2990, cardLast4: "1234", cardBrand: "VISA",
    });
    expect(evt?.currentPeriodEnd).toEqual(new Date("2026-11-05T00:00:00Z"));
  });

  it("subscription.renewed com periodo anterior ja vencido parte do pagamento", async () => {
    await mkSub({ status: "past_due", externalSubscriptionId: SUBS, currentPeriodEnd: new Date("2026-09-01T00:00:00Z") });
    const evt = await parse(mk(), renewedCard);
    expect(evt?.currentPeriodEnd).toEqual(new Date("2026-10-27T12:00:00Z"));
  });

  it("subscription.payment_failed (sem customer/checkout): resolve so por subs_ -> payment.failed/past_due; preserva periodo; valor/metodo da assinatura", async () => {
    const end = new Date("2026-10-05T00:00:00Z");
    await mkSub({ status: "active", externalSubscriptionId: SUBS, currentPeriodEnd: end });
    const evt = await parse(mk(), paymentFailed);
    expect(evt).toMatchObject({
      eventId: "log_abc123xyz", type: "payment.failed", orgId: org.orgId, status: "past_due", currentPeriodEnd: end, amountCents: 2990, paymentMethod: "card",
      externalSubscriptionId: SUBS,
    });
    expect(warn.mock.calls.flat().join(" ")).toContain("retryNumber=1");
  });

  it("subscription.cancelled manual / automatico (max_payment_retries_exceeded, sem payment/checkout): resolve por subs_ -> canceled", async () => {
    await mkSub({ status: "active", externalSubscriptionId: SUBS, currentPeriodEnd: new Date("2026-10-05T00:00:00Z") });
    for (const fx of [cancelledManual, cancelledMaxRetries]) {
      const evt = await parse(mk(), fx);
      expect(evt).toMatchObject({ type: "subscription.canceled", status: "canceled", orgId: org.orgId, cancelAtPeriodEnd: false, externalSubscriptionId: SUBS });
    }
  });

  it("subscription.cancelled com cancelamento AGENDADO pelo usuario e periodo valido: so confirmacao (nao zera o acesso pago)", async () => {
    const end = new Date("2026-10-20T00:00:00Z");
    await mkSub({ status: "active", externalSubscriptionId: SUBS, currentPeriodEnd: end, cancelAtPeriodEnd: true });
    const evt = await parse(mk(), cancelledManual);
    expect(evt).toMatchObject({ type: "subscription.updated", status: "active", cancelAtPeriodEnd: true, currentPeriodEnd: end });
  });

  it("cancelamento por FALHA (max_payment_retries_exceeded) suspende mesmo com cancelamento agendado", async () => {
    await mkSub({ status: "past_due", externalSubscriptionId: SUBS, currentPeriodEnd: new Date("2026-10-20T00:00:00Z"), cancelAtPeriodEnd: true });
    const evt = await parse(mk(), cancelledMaxRetries);
    expect(evt).toMatchObject({ type: "subscription.canceled", status: "canceled" });
  });

  it("cancelamento agendado com periodo JA vencido (job ainda nao efetivou) cancela normalmente", async () => {
    await mkSub({ status: "active", externalSubscriptionId: SUBS, currentPeriodEnd: new Date("2026-09-01T00:00:00Z"), cancelAtPeriodEnd: true });
    expect(await parse(mk(), cancelledManual)).toMatchObject({ type: "subscription.canceled", status: "canceled" });
  });

  it("subscription.cancelled com a assinatura local JA cancelada -> ignorado (sem e-mail duplicado)", async () => {
    await mkSub({ status: "canceled", externalSubscriptionId: SUBS, canceledAt: new Date() });
    expect(await parse(mk(), cancelledManual)).toBeNull();
  });

  it("D-063-13: evento de assinatura ANTIGA (subs_ diferente da gravada) e ignorado com log, nunca cancela a nova", async () => {
    await mkSub({ status: "active", externalSubscriptionId: "subs_NOVAnovaNOVAnovaNOVAnova", externalCheckoutId: BILL, currentPeriodEnd: new Date("2026-10-20T00:00:00Z") });
    for (const fx of [cancelledManual, renewedCard, paymentFailed]) expect(await parse(mk(), fx)).toBeNull();
    expect(warn.mock.calls.flat().join(" ")).toContain("assinatura antiga ignorada");
  });

  it("D-063-13: subscription.completed com subs_ NOVO substitui o id gravado", async () => {
    await mkSub({ status: "active", externalSubscriptionId: "subs_ANTIGAantigaANTIGAantiga", externalCheckoutId: BILL });
    expect(await parse(mk(), completedCard)).toMatchObject({ type: "subscription.created", externalSubscriptionId: SUBS });
  });

  it("transparent.completed (PIX): correlaciona por pixChargeId (id da doc `char_...` OU `pix_char_...` da criacao); ciclo de calendario; preserva ids da assinatura", async () => {
    const end = new Date("2026-10-01T00:00:00Z");
    for (const stored of ["char_xyz789", "pix_char_xyz789"]) {
      await prisma.subscription.deleteMany({ where: { orgId: org.orgId } });
      await mkSub({ status: "active", pixManaged: true, pixChargeId: stored, currentPeriodEnd: end, externalSubscriptionId: "subs_keep", externalCustomerId: "cust_keep" });
      const evt = await parse(mk(), transparentPix);
      expect(evt).toMatchObject({
        type: "subscription.updated", orgId: org.orgId, status: "active", paymentMethod: "pix", amountCents: 5000, externalPaymentId: "char_xyz789",
        externalSubscriptionId: "subs_keep", externalCustomerId: "cust_keep", currentPeriodEnd: new Date("2026-11-01T00:00:00Z"),
      });
      expect(evt?.eventId).toMatch(/^abacatepay:transparent\.completed:[0-9a-f]{32}$/); // a doc nao mostra `id` neste evento -> hash do corpo
    }
  });

  it("transparent.completed: sem pixChargeId, correlaciona pelo externalId `lf-pix:<orgId>:...`", async () => {
    await mkSub({ status: "active", pixManaged: true, currentPeriodEnd: new Date("2026-10-01T00:00:00Z") });
    const body = edit(transparentPix, { "data.transparent.id": "char_outro", "data.transparent.externalId": `lf-pix:${org.orgId}:1790000000000:ab12cd34` });
    expect(await parse(mk(), body)).toMatchObject({ orgId: org.orgId, status: "active" });
  });

  it("transparent.completed sem nenhum elo -> null + log de pagamento orfao (so ids)", async () => {
    expect(await parse(mk(), transparentPix)).toBeNull();
    expect(err.mock.calls.flat().join(" ")).toMatch(/\[billing-orphan-payment\] event=transparent\.completed .*transparent=char_xyz789/);
  });

  it("eventos reconhecidos e SEM efeito (trial_started, checkout.completed) e desconhecidos -> null + warn estruturado sem PII", async () => {
    const p = mk();
    expect(await parse(p, trialStarted)).toBeNull();
    expect(await parse(p, checkoutCompleted)).toBeNull();
    expect(await parse(p, { id: "log_1", event: "payout.completed", data: {} })).toBeNull();
    expect(await parse(p, { id: "log_2", event: "evento.novo.da.v3", data: { x: 1 } })).toBeNull();
    const logs = warn.mock.calls.flat().join("\n");
    expect(logs).toContain("event=subscription.trial_started");
    expect(logs).toContain("event=checkout.completed");
    expect(logs).toContain("(desconhecido)");
    expect(logs).not.toContain("maria@exemplo.com");
    expect(logs).not.toContain("Maria");
  });

  it("payload fora do contrato nao quebra: JSON invalido/sem event = AppError(validation); data ausente/vazia/campos extras = null (orfao), nunca excecao", async () => {
    const p = mk();
    await expect(p.parseWebhookEvent("{ nao e json")).rejects.toBeInstanceOf(AppError);
    await expect(p.parseWebhookEvent(JSON.stringify({ id: "x", data: {} }))).rejects.toBeInstanceOf(AppError);
    expect(await parse(p, { id: "log_9", event: "subscription.renewed" })).toBeNull();
    expect(await parse(p, { id: "log_9", event: "subscription.renewed", data: null })).toBeNull();
    expect(await parse(p, { id: "log_9", event: "subscription.renewed", data: { subscription: "texto", checkout: 3, campoNovo: { a: 1 } } })).toBeNull();
  });
});

describe("correlacao em cascata (D-063-11)", () => {
  it("elo 3: checkout.externalId `lf:<orgId>:<attempt>` (sem ids gravados) -> org existente", async () => {
    await mkSub();
    const body = edit(completedCard, { "data.checkout.externalId": `lf:${org.orgId}:ab12cd34`, "data.checkout.id": "bill_desconhecido" });
    expect(await parse(mk(), body)).toMatchObject({ orgId: org.orgId, type: "subscription.created" });
  });

  it("elo 3 com org que NAO existe -> cai no fallback por API e, sem resposta util, vira orfao", async () => {
    const api = fakeAbacateApi();
    api.override("GET /subscriptions/get", () => ({ status: 400, data: { success: false, data: null, error: "Subscription not found" } }));
    api.override("GET /subscriptions/checkouts/get", () => ({ status: 400, data: { success: false, data: null, error: "Checkout not found" } }));
    const body = edit(completedCard, { "data.checkout.externalId": `lf:${randomUUID()}:ab12cd34` });
    expect(await parse(mk(api), body)).toBeNull();
    expect(err.mock.calls.flat().join(" ")).toContain(`[billing-orphan-payment] event=subscription.completed eventId=log_taQArRTApemxwcbw5EJeF3hS subs=${SUBS} bill=${BILL}`);
  });

  it("elo 4 (API): payment_failed so com subs_ desconhecido -> subscriptions/get (checkoutId) acha o externalCheckoutId local", async () => {
    await mkSub({ status: "active", externalCheckoutId: "bill_via_api", currentPeriodEnd: new Date("2026-10-05T00:00:00Z") });
    const api = fakeAbacateApi();
    api.override("GET /subscriptions/get", () => ({ status: 200, data: { success: true, data: { id: SUBS, checkoutId: "bill_via_api" } } }));
    const evt = await parse(mk(api), paymentFailed);
    expect(evt).toMatchObject({ type: "payment.failed", orgId: org.orgId });
    expect(api.callsTo("GET /subscriptions/get")[0]!.params).toEqual({ id: SUBS });
    expect(api.callsTo("GET /subscriptions/checkouts/get")).toHaveLength(0);
  });

  it("elo 4 (API): checkouts/get devolve externalId `lf:` ou metadata.orgId", async () => {
    await mkSub({ status: "active", currentPeriodEnd: new Date("2026-10-05T00:00:00Z") });
    for (const checkout of [{ externalId: `lf:${org.orgId}:x` }, { externalId: null, metadata: { orgId: org.orgId } }]) {
      const api = fakeAbacateApi();
      api.override("GET /subscriptions/get", () => ({ status: 200, data: { success: true, data: { id: SUBS, checkoutId: "bill_zzz" } } }));
      api.override("GET /subscriptions/checkouts/get", () => ({ status: 200, data: { success: true, data: { id: "bill_zzz", ...checkout } } }));
      expect(await parse(mk(api), paymentFailed)).toMatchObject({ orgId: org.orgId, type: "payment.failed" });
      expect(api.callsTo("GET /subscriptions/checkouts/get")[0]!.params).toEqual({ id: "bill_zzz" });
    }
  });

  it("nenhum elo (e a API nao conhece) -> null + [billing-orphan-payment] so com ids; responde sem excecao", async () => {
    const api = fakeAbacateApi();
    api.override("GET /subscriptions/get", () => ({ status: 400, data: { success: false, data: null, error: "Subscription not found" } }));
    expect(await parse(mk(api), paymentFailed)).toBeNull();
    const line = err.mock.calls.flat().join(" ");
    expect(line).toContain(`[billing-orphan-payment] event=subscription.payment_failed eventId=log_abc123xyz subs=${SUBS}`);
    expect(line).not.toMatch(/@|taxId|Maria/);
  });

  it("falha de rede no fallback por API nao quebra o webhook (orfao + warn)", async () => {
    const api = fakeAbacateApi();
    api.override("GET /subscriptions/get", () => ({ status: 500, data: {} }));
    expect(await parse(mk(api), paymentFailed)).toBeNull();
  });

  it("isolamento entre organizacoes: o mesmo subs_ de OUTRA org nao e usado; elos locais vencem a API", async () => {
    await prisma.subscription.create({ data: { orgId: other.orgId, planId: proId, status: "active", cadence: "monthly", externalSubscriptionId: "subs_de_outra_org" } });
    await mkSub({ status: "active", externalSubscriptionId: SUBS });
    const api = fakeAbacateApi();
    const evt = await parse(mk(api), renewedCard);
    expect(evt?.orgId).toBe(org.orgId);
    expect(api.calls).toHaveLength(0); // elo 1 resolveu: nenhuma chamada a API
  });
});

describe("handleBillingWebhook (autenticacao, idempotencia e efeito no banco)", () => {
  const url = (secret: string | null = SECRET) => `http://app.test/api/billing/webhook${secret ? `?webhookSecret=${secret}` : ""}`;
  const send = (body: unknown, secret: string | null = SECRET, provider = mk(undefined, () => new Date())) =>
    handleBillingWebhook(new Request(url(secret), { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }), { provider });
  const fresh = (fx: unknown, over: Record<string, unknown> = {}) => ({ ...clone(fx as object), id: `log_${randomUUID()}`, ...over });

  it("?webhookSecret errado/ausente -> 401 e nada e gravado", async () => {
    await mkSub({ externalCheckoutId: BILL });
    expect((await send(completedCard, "segredo-errado-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")).status).toBe(401);
    expect((await send(completedCard, null)).status).toBe(401);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { orgId: org.orgId } })).status).toBe("incomplete");
  });

  it("completed ativa a casca (por bill_, sem metadata): 200 processed, Subscription active + ids do provedor, org ativa; retentativa (mesmo log_) = duplicate", async () => {
    await mkSub({ externalCheckoutId: BILL });
    const body = fresh(completedCard);
    const res = await send(body);
    expect(res.status).toBe(200);
    expect((await res.json()).result).toBe("processed");
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { orgId: org.orgId } });
    expect(sub).toMatchObject({ status: "active", externalSubscriptionId: SUBS, externalCustomerId: "cust_def456", externalCheckoutId: BILL });
    expect(sub.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now());
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } })).status).toBe("active");
    expect((await (await send(body)).json()).result).toBe("duplicate");
    expect(await prisma.webhookEvent.count({ where: { eventId: body.id } })).toBe(1);
  });

  it("payment_failed -> past_due (+ pastDueSince) pelo mesmo processBillingEvent; renewed seguinte recupera", async () => {
    await mkSub({ status: "active", externalSubscriptionId: SUBS, currentPeriodEnd: new Date(Date.now() + 5 * 86400_000) });
    expect((await (await send(fresh(paymentFailed))).json()).result).toBe("processed");
    let sub = await prisma.subscription.findUniqueOrThrow({ where: { orgId: org.orgId } });
    expect(sub.status).toBe("past_due");
    expect(sub.pastDueSince).not.toBeNull();
    expect((await (await send(fresh(renewedCard))).json()).result).toBe("processed");
    sub = await prisma.subscription.findUniqueOrThrow({ where: { orgId: org.orgId } });
    expect(sub.status).toBe("active");
    expect(sub.pastDueSince).toBeNull();
  });

  it("cancelled automatico (max retries) -> canceled + org suspensa; cancelled AGENDADO pelo usuario NAO tira o acesso", async () => {
    await mkSub({ status: "past_due", externalSubscriptionId: SUBS, pastDueSince: new Date(), currentPeriodEnd: new Date(Date.now() + 86400_000) });
    expect((await (await send(fresh(cancelledMaxRetries))).json()).result).toBe("processed");
    expect((await prisma.subscription.findUniqueOrThrow({ where: { orgId: org.orgId } })).status).toBe("canceled");
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } })).status).toBe("suspended");

    await prisma.subscription.deleteMany({ where: { orgId: org.orgId } });
    await prisma.organization.update({ where: { id: org.orgId }, data: { status: "active", suspendedReason: null } });
    const end = new Date(Date.now() + 10 * 86400_000);
    await mkSub({ status: "active", externalSubscriptionId: SUBS, currentPeriodEnd: end, cancelAtPeriodEnd: true });
    expect((await (await send(fresh(cancelledManual))).json()).result).toBe("processed");
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { orgId: org.orgId } });
    expect(sub).toMatchObject({ status: "active", cancelAtPeriodEnd: true, canceledAt: null });
    expect(sub.currentPeriodEnd!.getTime()).toBe(end.getTime());
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } })).status).toBe("active");
  });

  it("evento ignorado -> 200 ignored (e nunca 410); orfao -> 200 ignored", async () => {
    expect((await (await send(fresh(trialStarted))).json()).result).toBe("ignored");
    const orphanRes = await send(fresh(paymentFailed), SECRET, mk(fakeAbacateApi()));
    expect(orphanRes.status).toBe(200);
    expect(orphanRes.status).not.toBe(410);
  });

  it("payload invalido -> 400 sem vazar detalhe", async () => {
    const res = await send("{ nao e json");
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toMatch(/SyntaxError/);
  });

  it("recibo: reenvio manual (log_ NOVO) da mesma cobranca nao duplica o e-mail (dedupe por payment.id)", async () => {
    await mkSub({ status: "active", externalSubscriptionId: SUBS, currentPeriodEnd: new Date(Date.now() + 86400_000) });
    await send(fresh(renewedCard));
    const receipts = () => vi.mocked(sendSystemEmail).mock.calls.filter((c) => c[3] === "payment_receipt");
    expect(receipts()).toHaveLength(1);
    expect(receipts()[0]![2].text).toContain("VISA");
    expect(receipts()[0]![2].text).toContain("final 1234");
    await send(fresh(renewedCard));
    expect(receipts()).toHaveLength(1);
  });
});
