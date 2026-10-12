import "dotenv/config";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/channels/system-mail", () => ({ sendSystemEmail: vi.fn(async () => ({ ok: true, messageId: "" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { DAY, ensureTestPlan, mkIcp, setTrial } from "@/lib/test-utils/trial-fixture";
import { signInAs, signOut } from "@/lib/auth/test-helpers";
import { sendSystemEmail } from "@/lib/channels/system-mail";
import { createCheckoutSession } from "@/lib/actions/billing";
import { createCampaign } from "@/lib/actions/campaign";
import { processBillingEvent } from "./process-event";
import { syncOrgStatuses } from "./status-map";
import { AbacatePayPaymentProvider } from "./providers/abacatepay";
import { keyFingerprintOf } from "./providers/abacatepay-catalog";
import { fakeAbacateApi } from "./providers/abacatepay.test-helper";
import completedCard from "./providers/__fixtures__/abacatepay/subscription-completed-card.json";
import type { ParsedBillingEvent } from "./provider";

const NOW = new Date("2026-09-27T12:00:00Z");
const API_KEY = "test-abacatepay-api-key-065-upgrade";
const SECRET = "test-abacatepay-webhook-secret-32chars-min";
const FP = keyFingerprintOf(API_KEY);
const BILL = "bill_jskd3TMfScHZDJe5NSZjTmQ4";
const PROD = "prod_bx4BstRWhQ2SUcKsPt4c6pmq";

let org: TestOrg;
let starterId: string;
const as = () => signInAs(org.userId, { orgId: org.orgId, platformRole: "provider" });
const scenarios = () => vi.mocked(sendSystemEmail).mock.calls.map((c) => c[3]);
const getSub = () => prisma.subscription.findUniqueOrThrow({ where: { orgId: org.orgId }, select: { status: true, trialEndsAt: true, planId: true, externalCheckoutId: true, plan: { select: { key: true } } } });
const getOrg = () => prisma.organization.findUniqueOrThrow({ where: { id: org.orgId }, select: { status: true, suspendedReason: true } });
const activeEvent = (over: Partial<ParsedBillingEvent> = {}): ParsedBillingEvent => ({
  eventId: `evt_065_${Math.random().toString(36).slice(2)}`, type: "subscription.created", orgId: org.orgId, planKey: "starter", cadence: "monthly", status: "active",
  currentPeriodEnd: new Date(NOW.getTime() + 30 * DAY), cancelAtPeriodEnd: false, externalCustomerId: "cus_1", externalSubscriptionId: "subs_1", paymentMethod: "card", paidAt: NOW, ...over,
});

beforeAll(async () => {
  starterId = (await prisma.plan.findUniqueOrThrow({ where: { key: "starter" } })).id;
  await ensureTestPlan("zz-up-small", { maxCampaigns: 1 });
});
beforeEach(async () => {
  org = await createTestOrg("upgrade-065");
  vi.mocked(sendSystemEmail).mockClear();
});
afterEach(async () => {
  signOut();
  await prisma.webhookEvent.deleteMany({ where: { orgId: org.orgId } });
  await prisma.emailDispatchLog.deleteMany({ where: { orgId: org.orgId } });
  await prisma.billingProduct.deleteMany({ where: { keyFingerprint: FP } });
  await purgeTestOrg(org);
});
afterAll(() => prisma.$disconnect());

describe("upgrade do trial Free (SPEC-065, D-065-9/15)", () => {
  it("checkout do owner em trial (mock): vira active no plano pago, trialEndsAt = null, limites novos valem na hora; org active e suspendedReason null", async () => {
    await setTrial(org.orgId, "zz-up-small");
    await as();
    const icp = await mkIcp(org);
    expect((await createCampaign({ name: "c1", icpId: icp, status: "active" })).ok).toBe(true);
    expect((await createCampaign({ name: "c2", icpId: icp, status: "active" })).ok).toBe(false); // limite do trial
    const r = await createCheckoutSession({ planKey: "starter", cadence: "monthly" });
    expect(r.ok).toBe(true);
    expect(await getSub()).toMatchObject({ status: "active", trialEndsAt: null, planId: starterId });
    expect(await getOrg()).toEqual({ status: "active", suspendedReason: null });
    expect((await createCampaign({ name: "c2", icpId: icp, status: "active" })).ok).toBe(true); // Starter = 3 ativas: libera na hora
    expect(scenarios()).toContain("subscription_success");
  });

  it("org EXPIRADA (suspensa pelo tick) que paga volta a active sem novo login; reason limpo; ainda no trial (abandonar o checkout) permanece trialing", async () => {
    await setTrial(org.orgId, "zz-up-small", true);
    await syncOrgStatuses(new Date());
    expect(await getOrg()).toEqual({ status: "suspended", suspendedReason: "automatic" });
    await as();
    expect((await createCampaign({ name: "x", icpId: await mkIcp(org), status: "active" })).ok).toBe(false);
    expect((await createCheckoutSession({ planKey: "starter", cadence: "yearly" })).ok).toBe(true);
    expect(await getOrg()).toEqual({ status: "active", suspendedReason: null });
    expect((await createCampaign({ name: "x", icpId: await mkIcp(org), status: "active" })).ok).toBe(true); // mesma sessao
  });

  it("nao-dono nao inicia checkout; abandono (sem evento) deixa trialing; plano `free`/`courtesy` nao tem checkout", async () => {
    await setTrial(org.orgId, "zz-up-small");
    const { randomUUID } = await import("node:crypto");
    const memberId = randomUUID();
    await prisma.user.create({ data: { id: memberId, name: "m", email: `zz-065-up-${memberId.slice(0, 8)}@test.local`, role: "provider" } });
    await prisma.membership.create({ data: { userId: memberId, orgId: org.orgId, orgRole: "member" } });
    await signInAs(memberId, { orgId: org.orgId, platformRole: "provider" });
    expect(await createCheckoutSession({ planKey: "starter", cadence: "monthly" })).toMatchObject({ ok: false });
    await as();
    for (const planKey of ["free", "courtesy", "business"]) expect((await createCheckoutSession({ planKey, cadence: "monthly" })).ok, planKey).toBe(false);
    expect((await getSub()).status).toBe("trialing");
    await prisma.membership.deleteMany({ where: { userId: memberId } });
    await prisma.user.delete({ where: { id: memberId } });
  });

  it("webhook idempotente: mesmo eventId 2x = `duplicate`, sem 2o e-mail e sem alterar o estado", async () => {
    await setTrial(org.orgId, "zz-up-small");
    const ev = activeEvent();
    expect(await processBillingEvent(ev, NOW)).toBe("processed");
    expect(await processBillingEvent(ev, NOW)).toBe("duplicate");
    expect(scenarios().filter((s) => s === "subscription_success")).toHaveLength(1);
    expect(await getSub()).toMatchObject({ status: "active", trialEndsAt: null });
  });

  it("evento fora de ordem: `active` ja aplicado e um `trialing` tardio NAO recria prazo de trial (preserva null)", async () => {
    await setTrial(org.orgId, "zz-up-small");
    await processBillingEvent(activeEvent(), NOW);
    await processBillingEvent(activeEvent({ status: "trialing", type: "subscription.updated" }), NOW);
    expect((await getSub()).trialEndsAt).toBeNull();
  });

  it("trial expirado nao dispara auto_suspended; ao pagar, o trialEndsAt antigo some", async () => {
    await setTrial(org.orgId, "zz-up-small", true);
    await processBillingEvent(activeEvent(), NOW);
    expect((await getSub()).trialEndsAt).toBeNull();
  });
});

describe("adaptador AbacatePay (063a) com Subscription em `trialing` (nunca exercitado: so com casca `incomplete`)", () => {
  it("createCheckoutSession grava externalCheckoutId no trial SEM alterar status/trialEndsAt; o webhook subscription.completed (correlacao por checkout id) ativa e zera o trial", async () => {
    await setTrial(org.orgId, "zz-up-small");
    const before = await getSub();
    const api = fakeAbacateApi();
    const p = new AbacatePayPaymentProvider({ apiKey: API_KEY, webhookSecret: SECRET, adapter: api.adapter, retry: false, clock: () => NOW, errorLog: () => undefined });
    const r = await p.createCheckoutSession({ orgId: org.orgId, planKey: "starter", cadence: "monthly", customerEmail: "dono@example.com", successUrl: "http://app.test/configuracoes/assinatura?checkout=success", cancelUrl: "http://app.test/configuracoes/assinatura?checkout=cancel" });
    expect(r.sessionId).toMatch(/^bill_/);
    const mid = await getSub();
    expect(mid).toMatchObject({ status: "trialing", planId: before.planId });
    expect(mid.trialEndsAt).toEqual(before.trialEndsAt);
    expect(mid.externalCheckoutId).toBe(r.sessionId); // abandono do checkout: segue trialing

    // webhook real do provedor: correlaciona pelo checkout id gravado (bill_) com a org EXISTENTE (sem casca)
    await prisma.subscription.update({ where: { orgId: org.orgId }, data: { externalCheckoutId: BILL } });
    await prisma.billingProduct.create({ data: { provider: "abacatepay", keyFingerprint: FP, planId: starterId, cadence: "monthly", priceCents: 2990, externalId: "lf-starter-monthly-2990", providerProductId: PROD, devMode: true } });
    const evt = await p.parseWebhookEvent(JSON.stringify(completedCard));
    expect(evt).toMatchObject({ orgId: org.orgId, status: "active", planKey: "starter" });
    expect(await processBillingEvent(evt!, NOW)).toBe("processed");
    expect(await getSub()).toMatchObject({ status: "active", trialEndsAt: null, planId: starterId });
    expect(await getOrg()).toEqual({ status: "active", suspendedReason: null });
  });
});

describe("QA 065a: cancelar NAO e permitido com trial expirado; exclusao de conta funciona", () => {
  it("owner de org expirada chamando cancelSubscription continua bloqueado (nada muda) e findDeletionBlockers ignora o trial expirado (Free e legado)", async () => {
    const { cancelSubscription } = await import("@/lib/actions/billing");
    const { findDeletionBlockers } = await import("@/lib/account-deletion/blockers");
    await setTrial(org.orgId, "zz-up-small", true);
    await prisma.user.update({ where: { id: org.userId }, data: { passwordHash: "x" } }); // evita o bloqueio `no_password` (fora do assunto)
    await as();
    expect(await cancelSubscription()).toMatchObject({ ok: false, errors: { code: ["trial_expired"] } });
    expect((await getSub()).status).toBe("trialing");
    expect((await findDeletionBlockers(prisma, org.userId)).map((b) => b.code)).toEqual([]); // plano de teste expirado
    await prisma.subscription.update({ where: { orgId: org.orgId }, data: { planId: starterId } }); // trial legado de plano pago, expirado
    expect((await findDeletionBlockers(prisma, org.userId)).map((b) => b.code)).toEqual([]);
    await prisma.subscription.update({ where: { orgId: org.orgId }, data: { trialEndsAt: new Date(Date.now() + 5 * DAY) } }); // vigente: bloqueia (comportamento anterior)
    expect((await findDeletionBlockers(prisma, org.userId)).map((b) => b.code)).toEqual(["active_subscription"]);
  });
  it("cancelSubscriptionForOrg recusa o plano free", async () => {
    const { cancelSubscriptionForOrg } = await import("./cancel-subscription");
    await setTrial(org.orgId, "free");
    const r = await cancelSubscriptionForOrg(org.orgId);
    expect(r).toMatchObject({ ok: false });
    expect((await getSub()).status).toBe("trialing");
  });
});
