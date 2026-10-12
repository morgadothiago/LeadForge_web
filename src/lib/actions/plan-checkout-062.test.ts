import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// SPEC-062 (062a): startPlanCheckout / completeOrganizationSetup / getPlanCheckoutState / cancelPendingSubscription / webhook ligando a casca.
const holder = vi.hoisted(() => ({ mode: "fake" as "fake" | "real" | "fail", calls: [] as Array<{ orgId: string; planKey: string; cadence: string; successUrl: string; cancelUrl: string; method?: string }> }));
vi.mock("@/lib/channels/system-mail", () => ({ sendSystemEmail: vi.fn(async () => ({ ok: true, messageId: "m1" })) }));
vi.mock("@/lib/billing/provider-factory", async () => {
  const actual = await vi.importActual<typeof import("@/lib/billing/provider-factory")>("@/lib/billing/provider-factory");
  const { AppError } = await import("@/lib/errors");
  const fake = {
    name: "stripe" as const, // `stripe`: nao exige o Bearer do mock no webhook; aqui so simula um provedor EXTERNO (checkout nao muda estado)
    createCheckoutSession: vi.fn(async (input: { orgId: string; planKey: string; cadence: string; successUrl: string; cancelUrl: string; method?: string }) => {
      holder.calls.push(input);
      return { url: `https://pay.example.test/${input.orgId}`, sessionId: "s1" };
    }),
    createPortalSession: vi.fn(),
    cancelSubscription: vi.fn(async () => ({ providerConfirmed: true })),
    resumeSubscription: vi.fn(async () => ({ providerConfirmed: true })),
    verifyWebhookSignature: () => true,
    parseWebhookEvent: () => null,
  };
  return {
    ...actual,
    getPaymentProvider: (...a: Parameters<typeof actual.getPaymentProvider>) => {
      if (holder.mode === "real") return actual.getPaymentProvider(...a);
      if (holder.mode === "fail") {
        return { ...fake, createCheckoutSession: async () => { throw new AppError({ code: "upstream", userMessage: "Gateway fora do ar", status: 502 }); } };
      }
      return fake;
    },
  };
});

import { prisma } from "@/lib/prisma";
import { resetPaymentProviderCache } from "@/lib/billing/provider-factory";
import { processBillingEvent } from "@/lib/billing/process-event";
import { sendSystemEmail } from "@/lib/channels/system-mail";
import { clearOrgRateLimits } from "@/lib/org/rate-limit";
import { signInAs, signOut, testHeaders } from "@/lib/auth/test-helpers";
import { getSession } from "@/lib/auth/session";
import type { ParsedBillingEvent } from "@/lib/billing/provider";
import { cancelPendingSubscription, completeOrganizationSetup, getAccountStage, getPlanCheckoutState, startPlanCheckout } from "./billing";

const users: string[] = [];
const emails = () => vi.mocked(sendSystemEmail).mock.calls.map((c) => c[3]);

async function mkUser(opts: { verified?: boolean } = {}): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `zz-062-${id.slice(0, 8)}@test.local`;
  await prisma.user.create({ data: { id, name: "zz 062", email, role: "provider", emailVerifiedAt: opts.verified === false ? null : new Date() } });
  users.push(id);
  return { id, email };
}
const asNoOrg = (id: string) => signInAs(id, { orgId: null, platformRole: "provider" });
async function shellOf(userId: string) {
  return prisma.organization.findMany({ where: { setupPendingSince: { not: null }, memberships: { some: { userId } } }, include: { subscription: true, memberships: true } });
}
const evt = (orgId: string, over: Partial<ParsedBillingEvent> = {}): ParsedBillingEvent => ({
  eventId: `zz-evt-062-${randomUUID()}`, type: "subscription.created", orgId, planKey: "starter", cadence: "monthly", status: "active",
  currentPeriodEnd: new Date(Date.now() + 30 * 86400_000), cancelAtPeriodEnd: false, externalCustomerId: "cus_x", externalSubscriptionId: "sub_x", ...over,
});

beforeAll(() => {
  process.env.TRUSTED_PROXY_IP_HEADER = "x-real-ip";
});
beforeEach(() => {
  holder.mode = "fake";
  holder.calls.length = 0;
  vi.mocked(sendSystemEmail).mockClear();
  clearOrgRateLimits();
  resetPaymentProviderCache();
  testHeaders.current = new Headers({ "x-real-ip": "9.9.9.9" });
});
afterEach(() => {
  signOut();
  delete process.env.VERCEL_ENV;
  delete process.env.ALLOW_MOCK_BILLING;
});
afterAll(async () => {
  const orgs = await prisma.membership.findMany({ where: { userId: { in: users } }, select: { orgId: true } });
  const orgIds = orgs.map((o) => o.orgId);
  await prisma.emailDispatchLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: { in: orgIds } }] } });
  await prisma.webhookEvent.deleteMany({ where: { orgId: { in: orgIds } } });
  await prisma.orgAuditLog.deleteMany({ where: { orgId: { in: orgIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: users } } });
  await prisma.subscription.deleteMany({ where: { orgId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
});

describe("startPlanCheckout (D-062-10/12/24)", () => {
  it("sem sessao -> Sessao expirada; platform_admin -> Sem permissao", async () => {
    const r = await startPlanCheckout({ planKey: "starter", cadence: "monthly" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors._form?.[0]).toMatch(/Sessão expirada/);
    const u = await mkUser();
    await signInAs(u.id, { orgId: null, platformRole: "platform_admin" });
    const r2 = await startPlanCheckout({ planKey: "starter", cadence: "monthly" });
    if (!r2.ok) expect(r2.errors._form?.[0]).toMatch(/Sem permissão/);
    expect(r2.ok).toBe(false);
  });

  it("e-mail NAO verificado -> code email_unverified, nenhuma casca, provedor nao chamado", async () => {
    const u = await mkUser({ verified: false });
    await asNoOrg(u.id);
    const r = await startPlanCheckout({ planKey: "starter", cadence: "monthly" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.code).toEqual(["email_unverified"]);
    expect(await shellOf(u.id)).toHaveLength(0);
    expect(holder.calls).toHaveLength(0);
  });

  it("cria a casca (owner, setupPendingSince, Subscription incomplete, org suspensa) e abre o checkout por orgId so com cartao", async () => {
    const u = await mkUser();
    await asNoOrg(u.id);
    const r = await startPlanCheckout({ planKey: "starter", cadence: "yearly" });
    expect(r.ok).toBe(true);
    const shells = await shellOf(u.id);
    expect(shells).toHaveLength(1);
    const [s] = shells;
    expect(s.setupPendingSince).not.toBeNull();
    expect(s.slug).toMatch(/^pendente-[0-9a-f]{8}$/);
    expect(s.status).toBe("suspended");
    expect(s.memberships.map((m) => [m.userId, m.orgRole])).toEqual([[u.id, "owner"]]);
    expect(s.subscription).toMatchObject({ status: "incomplete", cadence: "yearly", trialEndsAt: null });
    expect(r.ok && r.data).toEqual({ url: `https://pay.example.test/${s.id}` });
    expect(holder.calls).toHaveLength(1);
    expect(holder.calls[0]).toMatchObject({ orgId: s.id, planKey: "starter", cadence: "yearly" });
    expect(holder.calls[0].method).toBeUndefined();
    expect(holder.calls[0].successUrl).toMatch(/\/assinar\/retorno$/);
    expect(holder.calls[0].cancelUrl).toMatch(/\/assinar\?checkout=cancel$/);
    // nenhum e-mail de trial e a sessao continua sem org
    expect(emails()).not.toContain("trial_started");
    expect((await getSession())?.orgId).toBeNull();
  });

  it("concorrencia: 2 chamadas simultaneas = 1 unica casca e 1 Subscription", async () => {
    const u = await mkUser();
    await asNoOrg(u.id);
    const rs = await Promise.all([startPlanCheckout({ planKey: "starter", cadence: "monthly" }), startPlanCheckout({ planKey: "starter", cadence: "monthly" })]);
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(await shellOf(u.id)).toHaveLength(1);
    expect(await prisma.subscription.count({ where: { org: { memberships: { some: { userId: u.id } } } } })).toBe(1);
  });

  it("casca nao paga: trocar plano/cadencia reaproveita a MESMA casca e abre novo checkout", async () => {
    const u = await mkUser();
    await asNoOrg(u.id);
    await startPlanCheckout({ planKey: "starter", cadence: "monthly" });
    const [first] = await shellOf(u.id);
    const r = await startPlanCheckout({ planKey: "pro", cadence: "yearly" });
    expect(r.ok).toBe(true);
    const shells = await shellOf(u.id);
    expect(shells).toHaveLength(1);
    expect(shells[0].id).toBe(first.id);
    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: shells[0].subscription!.planId } });
    expect([plan.key, shells[0].subscription!.cadence]).toEqual(["pro", "yearly"]);
    expect(holder.calls).toHaveLength(2);
  });

  it("casca JA PAGA: nao abre 2o checkout, devolve redirectTo /organizacao/nova", async () => {
    const u = await mkUser();
    await asNoOrg(u.id);
    await startPlanCheckout({ planKey: "starter", cadence: "monthly" });
    const [s] = await shellOf(u.id);
    await processBillingEvent(evt(s.id), new Date());
    holder.calls.length = 0;
    const r = await startPlanCheckout({ planKey: "pro", cadence: "monthly" });
    expect(r).toEqual({ ok: true, data: { redirectTo: "/organizacao/nova" } });
    expect(holder.calls).toHaveLength(0);
    expect(await shellOf(u.id)).toHaveLength(1);
  });

  it("plano business/courtesy/inexistente/inativo recusado (plan_unavailable) sem criar casca", async () => {
    const u = await mkUser();
    await asNoOrg(u.id);
    for (const planKey of ["business", "courtesy", "nao-existe"]) {
      const r = await startPlanCheckout({ planKey, cadence: "monthly" });
      expect(r.ok, planKey).toBe(false);
      if (!r.ok) expect(r.errors.code).toEqual(["plan_unavailable"]);
    }
    await prisma.plan.update({ where: { key: "starter" }, data: { active: false } });
    try {
      const r = await startPlanCheckout({ planKey: "starter", cadence: "monthly" });
      expect(r.ok).toBe(false);
    } finally {
      await prisma.plan.update({ where: { key: "starter" }, data: { active: true } });
    }
    expect(await shellOf(u.id)).toHaveLength(0);
  });

  it("provedor falhando: billing_unavailable, e a casca incomplete continua valida (estado consistente) para nova tentativa", async () => {
    const u = await mkUser();
    await asNoOrg(u.id);
    holder.mode = "fail";
    const r = await startPlanCheckout({ planKey: "starter", cadence: "monthly" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.code).toEqual(["billing_unavailable"]);
    const shells = await shellOf(u.id);
    expect(shells).toHaveLength(1);
    expect(shells[0].subscription?.status).toBe("incomplete");
    holder.mode = "fake";
    expect((await startPlanCheckout({ planKey: "starter", cadence: "monthly" })).ok).toBe(true);
    expect(await shellOf(u.id)).toHaveLength(1);
  });

  it("mock em PRODUCAO recusado (billing_unavailable) e NENHUMA casca criada; ALLOW_MOCK_BILLING=true libera (D-062-23)", async () => {
    const u = await mkUser();
    await asNoOrg(u.id);
    holder.mode = "real";
    process.env.VERCEL_ENV = "production";
    const r = await startPlanCheckout({ planKey: "starter", cadence: "monthly" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.code).toEqual(["billing_unavailable"]);
    expect(await shellOf(u.id)).toHaveLength(0);
    process.env.ALLOW_MOCK_BILLING = "true";
    resetPaymentProviderCache();
    const ok = await startPlanCheckout({ planKey: "starter", cadence: "monthly" });
    expect(ok.ok).toBe(true);
    resetPaymentProviderCache();
  });

  it("rate limit: a 6a tentativa na hora -> rate_limited", async () => {
    const u = await mkUser();
    await asNoOrg(u.id);
    let last;
    for (let i = 0; i < 6; i++) last = await startPlanCheckout({ planKey: "starter", cadence: "monthly" });
    expect(last?.ok).toBe(false);
    if (last && !last.ok) expect(last.errors.code).toEqual(["rate_limited"]);
  });

  it("modo mock (dev): o checkout ativa a casca pelo MESMO processBillingEvent -> pago_sem_org", async () => {
    const u = await mkUser();
    await asNoOrg(u.id);
    holder.mode = "real";
    const r = await startPlanCheckout({ planKey: "starter", cadence: "monthly" });
    expect(r.ok).toBe(true);
    if (r.ok && "url" in r.data) expect(r.data.url).toMatch(/\/assinar\/retorno\?session_id=/);
    const [s] = await shellOf(u.id);
    expect(s.subscription?.status).toBe("active");
    expect(s.status).toBe("active");
    expect((await getAccountStage()).ok && (await getAccountStage())).toMatchObject({ data: { stage: "pago_sem_org", redirectTo: "/organizacao/nova", pendingSetup: true } });
  });
});

describe("getPlanCheckoutState / getAccountStage", () => {
  it("none -> incomplete -> active conforme a Subscription da casca; emailVerified refletido", async () => {
    const u = await mkUser({ verified: false });
    await asNoOrg(u.id);
    expect(await getPlanCheckoutState()).toEqual({ ok: true, data: { status: "none", emailVerified: false } });
    await prisma.user.update({ where: { id: u.id }, data: { emailVerifiedAt: new Date() } });
    await startPlanCheckout({ planKey: "starter", cadence: "monthly" });
    expect(await getPlanCheckoutState()).toEqual({ ok: true, data: { status: "incomplete", planKey: "starter", cadence: "monthly", emailVerified: true } });
    const [s] = await shellOf(u.id);
    await processBillingEvent(evt(s.id), new Date());
    const st = await getPlanCheckoutState();
    expect(st.ok && st.data.status).toBe("active");
  });

  it("estado de outro usuario nunca vaza", async () => {
    const a = await mkUser();
    const b = await mkUser();
    await asNoOrg(a.id);
    await startPlanCheckout({ planKey: "starter", cadence: "monthly" });
    await asNoOrg(b.id);
    expect(await getPlanCheckoutState()).toEqual({ ok: true, data: { status: "none", emailVerified: true } });
  });
});

describe("webhook/processBillingEvent ligando o pagamento a casca (D-062-5/18)", () => {
  async function shellFor(): Promise<{ u: { id: string }; orgId: string }> {
    const u = await mkUser();
    await asNoOrg(u.id);
    await startPlanCheckout({ planKey: "starter", cadence: "monthly" });
    return { u, orgId: (await shellOf(u.id))[0].id };
  }

  it("evento active -> Subscription active + Organization active; mesmo eventId 2x = duplicate, 1 unico e-mail de confirmacao", async () => {
    const { orgId } = await shellFor();
    vi.mocked(sendSystemEmail).mockClear();
    const e = evt(orgId);
    expect(await processBillingEvent(e, new Date())).toBe("processed");
    expect(await processBillingEvent(e, new Date())).toBe("duplicate");
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, include: { subscription: true } });
    expect(org.subscription?.status).toBe("active");
    expect(org.status).toBe("active");
    expect(org.setupPendingSince).not.toBeNull(); // continua casca ate nomear
    expect(emails().filter((s) => s === "subscription_success")).toHaveLength(1);
  });

  it("POST /api/billing/webhook (mock + segredo): idempotente para a casca", async () => {
    const SECRET = "zz-mock-webhook-secret-32-chars-minimo-062";
    process.env.MOCK_WEBHOOK_SECRET = SECRET;
    holder.mode = "real";
    try {
      const { POST } = await import("@/app/api/billing/webhook/route");
      const { orgId } = await shellFor();
      const payload = { eventId: `zz-evt-062-${randomUUID()}`, type: "subscription.created", orgId, planKey: "starter", cadence: "monthly", status: "active", currentPeriodEnd: new Date(Date.now() + 86400_000).toISOString(), cancelAtPeriodEnd: false, externalCustomerId: "c", externalSubscriptionId: "s" };
      const call = () => POST(new Request("http://app.test/api/billing/webhook", { method: "POST", body: JSON.stringify(payload), headers: { authorization: `Bearer ${SECRET}` } }));
      expect((await (await call()).json()).result).toBe("processed");
      expect((await (await call()).json()).result).toBe("duplicate");
      expect((await prisma.subscription.findUniqueOrThrow({ where: { orgId } })).status).toBe("active");
      expect(await prisma.webhookEvent.count({ where: { eventId: payload.eventId } })).toBe(1);
    } finally {
      delete process.env.MOCK_WEBHOOK_SECRET;
    }
  });

  it("fora de ordem: past_due antes de active nao cria 2 cascas nem estado invalido; active posterior prevalece", async () => {
    const { u, orgId } = await shellFor();
    await processBillingEvent(evt(orgId, { type: "payment.failed", status: "past_due" }), new Date());
    await processBillingEvent(evt(orgId), new Date());
    expect((await prisma.subscription.findUniqueOrThrow({ where: { orgId } })).status).toBe("active");
    expect(await shellOf(u.id)).toHaveLength(1);
  });

  it("evento para orgId inexistente -> org_not_found + linha [billing-orphan-payment] so com ids (sem PII)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const ghost = randomUUID();
      const e = evt(ghost);
      expect(await processBillingEvent(e, new Date())).toBe("org_not_found");
      const line = spy.mock.calls.map((c) => String(c[0])).find((l) => l.includes("[billing-orphan-payment]"));
      expect(line).toContain(e.eventId);
      expect(line).toContain(ghost);
      expect(line).not.toMatch(/@/);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("completeOrganizationSetup (D-062-13)", () => {
  async function paidShell(): Promise<{ u: { id: string; email: string }; orgId: string }> {
    const u = await mkUser();
    await asNoOrg(u.id);
    await startPlanCheckout({ planKey: "starter", cadence: "monthly" });
    const orgId = (await shellOf(u.id))[0].id;
    await processBillingEvent(evt(orgId), new Date());
    return { u, orgId };
  }

  it("sem casca / casca incomplete -> no_paid_plan e nada criado", async () => {
    const u = await mkUser();
    await asNoOrg(u.id);
    const r = await completeOrganizationSetup({ name: "Acme" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.code).toEqual(["no_paid_plan"]);
    await startPlanCheckout({ planKey: "starter", cadence: "monthly" });
    const r2 = await completeOrganizationSetup({ name: "Acme" });
    if (!r2.ok) expect(r2.errors.code).toEqual(["no_paid_plan"]);
    expect(r2.ok).toBe(false);
    expect((await shellOf(u.id))).toHaveLength(1); // continua casca
  });

  it("nome vazio -> erro no campo name", async () => {
    const { } = await paidShell();
    const r = await completeOrganizationSetup({ name: "  " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.name?.[0]).toMatch(/obrigatório/);
  });

  it("casca paga: nomeia, vira org real (setupPendingSince nulo, active), owner, lastOrgId, auditoria, sessao na nova org", async () => {
    const { u, orgId } = await paidShell();
    const r = await completeOrganizationSetup({ name: "Acme Ltda" });
    expect(r).toEqual({ ok: true, data: { orgId, redirectTo: "/dashboard" } });
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect(org).toMatchObject({ name: "Acme Ltda", setupPendingSince: null, status: "active", suspendedReason: null });
    expect(org.slug).toBe("acme-ltda");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).lastOrgId).toBe(orgId);
    expect(await prisma.orgAuditLog.count({ where: { orgId, action: "org_created" } })).toBe(1);
    expect((await getSession())?.orgId).toBe(orgId);
    expect(await shellOf(u.id)).toHaveLength(0);
    // sem 2a Subscription e sem trial
    expect(await prisma.subscription.count({ where: { orgId } })).toBe(1);
    expect((await getAccountStage()).ok && (await getAccountStage())).toMatchObject({ data: { stage: "dono", pendingSetup: false } });
  });

  it("idempotente: 2o submit (outra aba) nao cria 2a org nem erra; duplo submit concorrente = 1 org", async () => {
    const { u, orgId } = await paidShell();
    const rs = await Promise.all([completeOrganizationSetup({ name: "Acme" }), completeOrganizationSetup({ name: "Acme" })]);
    expect(rs.every((r) => r.ok)).toBe(true);
    const again = await completeOrganizationSetup({ name: "Outro Nome" });
    expect(again).toEqual({ ok: true, data: { orgId, redirectTo: "/dashboard" } });
    expect(await prisma.membership.count({ where: { userId: u.id } })).toBe(1);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).name).toBe("Acme");
  });

  it("colisao de slug: nome igual ao de outra org recebe sufixo, sem erro", async () => {
    const a = await paidShell();
    const b = await paidShell();
    await signInAs(a.u.id, { orgId: null, platformRole: "provider" });
    expect((await completeOrganizationSetup({ name: "Mesma Empresa" })).ok).toBe(true);
    await signInAs(b.u.id, { orgId: null, platformRole: "provider" });
    expect((await completeOrganizationSetup({ name: "Mesma Empresa" })).ok).toBe(true);
    const slugs = (await prisma.organization.findMany({ where: { id: { in: [a.orgId, b.orgId] } }, select: { slug: true } })).map((o) => o.slug);
    expect(new Set(slugs).size).toBe(2);
  });

  it("usuario A nao finaliza a casca de B (nem por orgId no input): A sem casca -> no_paid_plan e a casca de B intacta", async () => {
    const b = await paidShell();
    const a = await mkUser();
    await asNoOrg(a.id);
    const r = await completeOrganizationSetup({ name: "Roubada", orgId: b.orgId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.code).toEqual(["no_paid_plan"]);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: b.orgId } });
    expect(org.setupPendingSince).not.toBeNull();
    expect(org.name).not.toBe("Roubada");
  });
});

describe("cancelPendingSubscription (D-062-20)", () => {
  it("sem casca -> erro; casca incomplete -> cancelamento imediato; casca paga com periodo -> agendado (053)", async () => {
    const u = await mkUser();
    await asNoOrg(u.id);
    const none = await cancelPendingSubscription();
    expect(none.ok).toBe(false);
    await startPlanCheckout({ planKey: "starter", cadence: "monthly" });
    const [s] = await shellOf(u.id);
    const imm = await cancelPendingSubscription();
    expect(imm.ok && imm.data.outcome).toBe("immediate");
    expect((await prisma.subscription.findUniqueOrThrow({ where: { orgId: s.id } })).status).toBe("canceled");

    const p = await mkUser();
    await asNoOrg(p.id);
    await startPlanCheckout({ planKey: "starter", cadence: "monthly" });
    const [ps] = await shellOf(p.id);
    await processBillingEvent(evt(ps.id), new Date());
    const sched = await cancelPendingSubscription();
    expect(sched.ok && sched.data.outcome).toBe("scheduled");
    expect((await prisma.subscription.findUniqueOrThrow({ where: { orgId: ps.id } })).cancelAtPeriodEnd).toBe(true);
  });
});
