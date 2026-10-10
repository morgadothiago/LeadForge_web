import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AxiosAdapter } from "axios";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { signInAs, signOut } from "@/lib/auth/test-helpers";
import { sendSystemEmail } from "@/lib/channels/system-mail";
import { AppError } from "@/lib/errors";
import { MockPaymentProvider } from "@/lib/billing/providers/mock";
import { AbacatePayPaymentProvider } from "@/lib/billing/providers/abacatepay";
import { runCancelEffectuationJob } from "@/lib/billing/cancel-effective";
import { runPixRenewalJob } from "@/lib/billing/pix-renewal";
import { computeOrgStatus, syncOrgStatuses, CANCEL_RETENTION_MS } from "@/lib/billing/status-map";
import { processBillingEvent } from "@/lib/billing/process-event";
import { cancelRequestedTemplate } from "@/lib/channels/email/templates/cancel-requested";
import { subscriptionCanceledTemplate } from "@/lib/channels/email/templates/subscription-canceled";
import { cancelSubscription, reactivateSubscription } from "./billing";

/** SPEC-053a — cancelar/reativar pela app. `sendSystemEmail` mockado; provider injetavel por teste. */
vi.mock("@/lib/channels/system-mail", () => ({ sendSystemEmail: vi.fn(async () => ({ ok: true, messageId: "" })) }));
const providerState = vi.hoisted(() => ({ override: null as unknown }));
vi.mock("@/lib/billing/provider-factory", async (orig) => {
  const actual = await orig<typeof import("@/lib/billing/provider-factory")>();
  return { ...actual, getPaymentProvider: () => providerState.override ?? actual.getPaymentProvider() };
});

let org: TestOrg;
let memberUserId: string;
let planId: string;
const DAY = 24 * 3600_000;

beforeEach(async () => {
  org = await createTestOrg("cancel-053a"); // org nova por teste: o rate limit da action e por org
  memberUserId = randomUUID();
  await prisma.user.create({ data: { id: memberUserId, name: "zz member", email: `zz-m-${memberUserId.slice(0, 8)}@test.local`, role: "provider" } });
  await prisma.membership.create({ data: { userId: memberUserId, orgId: org.orgId, orgRole: "member" } });
  planId = (await prisma.plan.findUniqueOrThrow({ where: { key: "starter" }, select: { id: true } })).id;
  providerState.override = null;
  vi.mocked(sendSystemEmail).mockClear();
});
afterEach(async () => {
  signOut();
  await prisma.subscription.deleteMany({ where: { orgId: org.orgId } });
  await prisma.webhookEvent.deleteMany({ where: { orgId: org.orgId } });
  await prisma.emailDispatchLog.deleteMany({ where: { orgId: org.orgId } });
  await prisma.membership.deleteMany({ where: { userId: memberUserId } });
  await prisma.user.deleteMany({ where: { id: memberUserId } });
  await purgeTestOrg(org);
});
afterAll(() => {
  providerState.override = null;
});

const signInOwner = () => signInAs(org.userId, { orgId: org.orgId, platformRole: "provider" });
const scenarios = () => vi.mocked(sendSystemEmail).mock.calls.map((c) => c[3]);
const mkSub = (over: Partial<Prisma.SubscriptionUncheckedCreateInput> = {}) =>
  prisma.subscription.create({
    data: { orgId: org.orgId, planId, status: "active", cadence: "monthly", currentPeriodEnd: new Date(Date.now() + 10 * DAY), externalCustomerId: "cus_x", externalSubscriptionId: "sub_x", ...over },
  });
const getSub = () => prisma.subscription.findUniqueOrThrow({ where: { orgId: org.orgId } });
const getOrg = () => prisma.organization.findUniqueOrThrow({ where: { id: org.orgId }, select: { status: true } });

describe("cancelSubscription (SPEC-053a)", () => {
  it("nao-owner recusado; sem sessao recusado; nada muda", async () => {
    await mkSub();
    await signInAs(memberUserId, { orgId: org.orgId, platformRole: "provider" });
    const r = await cancelSubscription();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors._form?.[0]).toMatch(/Sem permissão/);
    expect((await getSub()).cancelAtPeriodEnd).toBe(false);
    signOut();
    const r2 = await cancelSubscription();
    expect(r2.ok).toBe(false);
    expect(scenarios()).toEqual([]);
  });

  it("plano pago: agenda ao fim do periodo, MANTEM acesso (org active), e-mail #10 uma vez; duplo clique nao duplica", async () => {
    const sub = await mkSub();
    await signInOwner();
    const r = await cancelSubscription();
    expect(r.ok && r.data).toMatchObject({ status: "active", cancelAtPeriodEnd: true, outcome: "scheduled" });
    const after = await getSub();
    expect(after.cancelAtPeriodEnd).toBe(true);
    expect(after.status).toBe("active");
    expect(after.canceledAt).toBeNull();
    expect((await getOrg()).status).toBe("active");
    expect(scenarios()).toEqual(["cancel_requested"]);
    const [, , content] = vi.mocked(sendSystemEmail).mock.calls[0];
    expect(content.text).toMatch(/acesso continua normal até/);
    // duplo clique / reentrega
    const r2 = await cancelSubscription();
    expect(r2.ok && r2.data.outcome).toBe("already");
    expect(scenarios()).toEqual(["cancel_requested"]);
    expect((await getSub()).currentPeriodEnd?.getTime()).toBe(sub.currentPeriodEnd?.getTime());
  });

  it("duas chamadas concorrentes: um unico e-mail #10", async () => {
    await mkSub();
    await signInOwner();
    await Promise.all([cancelSubscription(), cancelSubscription()]);
    expect(scenarios().filter((s) => s === "cancel_requested")).toHaveLength(1);
  });

  it("trial: cancelamento imediato (D-053-3): canceled, org suspensa, canceledAt=agora, e-mail #11 (sem #10)", async () => {
    await mkSub({ status: "trialing", currentPeriodEnd: null, trialEndsAt: new Date(Date.now() + 5 * DAY) });
    await signInOwner();
    const r = await cancelSubscription();
    expect(r.ok && r.data).toMatchObject({ status: "canceled", cancelAtPeriodEnd: false, outcome: "immediate" });
    const after = await getSub();
    expect(after.status).toBe("canceled");
    expect(after.canceledAt).not.toBeNull();
    expect((await getOrg()).status).toBe("suspended");
    expect(scenarios()).toEqual(["subscription_canceled"]);
    expect((await cancelSubscription()).ok && true).toBe(true);
    expect(scenarios()).toEqual(["subscription_canceled"]);
  });

  it("provider falhando: erro ao usuario e NADA gravado localmente nem e-mail (sem divergencia)", async () => {
    await mkSub();
    providerState.override = Object.assign(new MockPaymentProvider(), {
      cancelSubscription: async () => {
        throw new AppError({ code: "config", userMessage: "Cancelamento indisponível no momento." });
      },
    });
    await signInOwner();
    const r = await cancelSubscription();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors._form?.[0]).toMatch(/indisponível/);
    expect((await getSub()).cancelAtPeriodEnd).toBe(false);
    expect(await prisma.webhookEvent.count({ where: { orgId: org.orgId } })).toBe(0);
    expect(scenarios()).toEqual([]);
  });

  it("rate limit: a 6a tentativa e recusada", async () => {
    await signInOwner();
    for (let i = 0; i < 5; i++) await cancelSubscription();
    const r = await cancelSubscription();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors._form?.[0]).toMatch(/Muitas tentativas/);
  });

  it("assinatura inexistente -> erro", async () => {
    await signInOwner();
    expect((await cancelSubscription()).ok).toBe(false);
  });

  it("AbacatePay (cartao e PIX): fallback local sem chamar o provedor (providerConfirmed=false)", async () => {
    const aba = new AbacatePayPaymentProvider({ apiKey: "k", webhookSecret: "s", adapter: (async () => { throw new Error("nao deve chamar a API"); }) as AxiosAdapter, retry: false });
    expect(await aba.cancelSubscription({ orgId: org.orgId, atPeriodEnd: true })).toEqual({ providerConfirmed: false });
    providerState.override = aba;
    await mkSub({ pixManaged: true });
    await signInOwner();
    const r = await cancelSubscription();
    expect(r.ok && r.data.outcome).toBe("scheduled");
    expect((await getSub()).cancelAtPeriodEnd).toBe(true);
  });
});

describe("reactivateSubscription (SPEC-053a)", () => {
  it("antes do fim: limpa cancelAtPeriodEnd, e-mail #12 uma vez; repetir e idempotente", async () => {
    await mkSub();
    await signInOwner();
    await cancelSubscription();
    vi.mocked(sendSystemEmail).mockClear();
    const r = await reactivateSubscription();
    expect(r.ok && r.data).toMatchObject({ cancelAtPeriodEnd: false, status: "active" });
    expect((await getSub()).cancelAtPeriodEnd).toBe(false);
    expect(scenarios()).toEqual(["subscription_reactivated"]);
    const r2 = await reactivateSubscription();
    expect(r2.ok && r2.data.outcome).toBe("already");
    expect(scenarios()).toEqual(["subscription_reactivated"]);
  });

  it("cancelar -> reativar -> cancelar de novo envia novo #10", async () => {
    await mkSub();
    await signInOwner();
    await cancelSubscription();
    await reactivateSubscription();
    await cancelSubscription();
    expect(scenarios()).toEqual(["cancel_requested", "subscription_reactivated", "cancel_requested"]);
  });

  it("ja efetivado (canceled) -> recusa orientando nova contratacao; sem e-mail", async () => {
    await mkSub({ status: "canceled", canceledAt: new Date() });
    await signInOwner();
    const r = await reactivateSubscription();
    expect(r.ok).toBe(false);
    expect(scenarios()).toEqual([]);
  });

  it("nao-owner recusado", async () => {
    await mkSub({ cancelAtPeriodEnd: true });
    await signInAs(memberUserId, { orgId: org.orgId, platformRole: "provider" });
    expect((await reactivateSubscription()).ok).toBe(false);
    expect((await getSub()).cancelAtPeriodEnd).toBe(true);
  });
});

describe("efetivacao no tick (runCancelEffectuationJob) + status-map", () => {
  it("antes do fim: nada; apos o fim: canceled, org suspensa, e-mail #11 uma vez, retencao conta da efetivacao", async () => {
    const periodEnd = new Date(Date.now() + 10 * DAY);
    await mkSub({ currentPeriodEnd: periodEnd });
    await signInOwner();
    await cancelSubscription();
    vi.mocked(sendSystemEmail).mockClear();

    expect(await runCancelEffectuationJob(new Date())).toEqual({ effectuated: 0, errors: 0 });
    expect((await getSub()).status).toBe("active");

    const later = new Date(periodEnd.getTime() + 60_000);
    expect(await runCancelEffectuationJob(later)).toEqual({ effectuated: 1, errors: 0 });
    const s = await getSub();
    expect(s.status).toBe("canceled");
    expect(s.canceledAt?.getTime()).toBe(later.getTime());
    expect((await getOrg()).status).toBe("suspended");
    expect(scenarios()).toEqual(["subscription_canceled"]);
    const text = vi.mocked(sendSystemEmail).mock.calls[0][2].text;
    const purge = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(later.getTime() + CANCEL_RETENTION_MS));
    expect(text).toContain(purge);
    // reprocessar: sem novo e-mail
    expect(await runCancelEffectuationJob(new Date(later.getTime() + DAY))).toEqual({ effectuated: 0, errors: 0 });
    expect(scenarios()).toEqual(["subscription_canceled"]);
  });

  it("reentrega do mesmo evento de efetivacao e duplicate (sem e-mail extra)", async () => {
    const periodEnd = new Date(Date.now() - DAY);
    await mkSub({ currentPeriodEnd: periodEnd, cancelAtPeriodEnd: true });
    const ev = { eventId: "dup-evt-053", type: "subscription.canceled" as const, orgId: org.orgId, planKey: "starter", cadence: "monthly" as const, status: "canceled" as const, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false, externalCustomerId: null, externalSubscriptionId: null };
    expect(await processBillingEvent(ev, new Date())).toBe("processed");
    expect(await processBillingEvent(ev, new Date())).toBe("duplicate");
    expect(scenarios()).toEqual(["subscription_canceled"]);
  });

  it("syncOrgStatuses suspende cancelAtPeriodEnd vencido mesmo se o job nao rodou", async () => {
    await mkSub({ cancelAtPeriodEnd: true, currentPeriodEnd: new Date(Date.now() - 1000) });
    await syncOrgStatuses(new Date());
    expect((await getOrg()).status).toBe("suspended");
  });

  it("PIX: cancelAtPeriodEnd para de gerar cobranca (pix-renewal)", async () => {
    await mkSub({ pixManaged: true, cancelAtPeriodEnd: true, currentPeriodEnd: new Date(Date.now() - 1000) });
    const aba = new AbacatePayPaymentProvider({ apiKey: "k", webhookSecret: "s", adapter: (async () => { throw new Error("nao deve gerar cobranca"); }) as AxiosAdapter, retry: false });
    expect(await runPixRenewalJob(new Date(), aba)).toEqual({ generated: 0, markedPastDue: 0, errors: 0 });
  });
});

describe("coerencia texto dos e-mails x computeOrgStatus (D-053-1)", () => {
  const periodEnd = new Date("2026-06-10T12:00:00Z");
  const sub = { status: "active" as const, pastDueSince: null, cancelAtPeriodEnd: true, currentPeriodEnd: periodEnd };

  it("#10 promete acesso ate a data: org ativa antes, suspensa a partir dela", () => {
    const { text } = cancelRequestedTemplate({ planName: "P", accessUntil: periodEnd, purgeDate: new Date(periodEnd.getTime() + CANCEL_RETENTION_MS), link: "http://x" });
    expect(text).toMatch(/acesso continua normal até 10 de junho de 2026/);
    expect(computeOrgStatus(sub, new Date(periodEnd.getTime() - 1000))).toBe("active");
    expect(computeOrgStatus(sub, periodEnd)).toBe("suspended");
  });

  it("#11 afirma acesso encerrado: canceled => suspended imediatamente", () => {
    const { text } = subscriptionCanceledTemplate({ planName: "P", accessEndedAt: periodEnd, purgeDate: new Date(periodEnd.getTime() + CANCEL_RETENTION_MS), link: "http://x" });
    expect(text).toMatch(/acesso foi encerrado em 10 de junho de 2026/);
    expect(computeOrgStatus({ status: "canceled", pastDueSince: null }, periodEnd)).toBe("suspended");
  });

  it("sem cancelAtPeriodEnd o comportamento antigo permanece (active/past_due)", () => {
    expect(computeOrgStatus({ status: "active", pastDueSince: null, cancelAtPeriodEnd: false, currentPeriodEnd: new Date(0) }, new Date())).toBe("active");
  });
});
