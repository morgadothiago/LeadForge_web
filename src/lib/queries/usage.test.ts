import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { DAY, ensureTestPlan, mkCampaign, setOrgPlan, setTrial } from "@/lib/test-utils/trial-fixture";
import { signInAs, signOut } from "@/lib/auth/test-helpers";
import { TrialExpiredError } from "@/lib/auth/require-admin";
import { dayKey } from "@/lib/billing/usage";
import { getBillingSummary, getOrgBannerState } from "./billing";
import { getPlanUsage } from "./usage";
import { getDashboardOnboarding } from "./onboarding";

/** SPEC-065b — leituras de uso (UsageMeter), resumo de assinatura (bloqueio) e onboarding do dashboard, com isolamento por organizacao. */
const LIMITS = { maxCampaigns: 2, maxWhatsappInstances: 1, maxEmailAccounts: 1, maxLeadsPerMonth: 5, maxSendsPerDay: 10 };
let A: TestOrg;
let B: TestOrg;
let memberId: string;
const as = (o: TestOrg) => signInAs(o.userId, { orgId: o.orgId, platformRole: "provider" });

beforeAll(async () => {
  await ensureTestPlan("zz-065b", LIMITS);
  A = await createTestOrg("065b-a");
  B = await createTestOrg("065b-b");
  memberId = randomUUID();
  await prisma.user.create({ data: { id: memberId, name: "zz membro", email: `zz-065b-m-${memberId.slice(0, 8)}@test.local`, role: "provider" } });
  await prisma.membership.create({ data: { userId: memberId, orgId: A.orgId, orgRole: "member" } });
});
afterEach(async () => {
  signOut();
  await prisma.usageCounter.deleteMany({ where: { orgId: { in: [A.orgId, B.orgId] } } });
});
afterAll(async () => {
  await prisma.membership.deleteMany({ where: { userId: memberId } });
  await prisma.user.deleteMany({ where: { id: memberId } });
  await purgeTestOrg(A);
  await purgeTestOrg(B);
});

describe("getPlanUsage (UsageMeter)", () => {
  it("estoque por linhas (so campanhas ATIVAS) e fluxo pelo UsageCounter; limites do plano", async () => {
    await setTrial(A.orgId, "zz-065b");
    await mkCampaign(A, "active");
    await mkCampaign(A, "paused");
    const now = new Date();
    await prisma.usageCounter.create({ data: { orgId: A.orgId, metric: "leads", periodKey: "trial", count: 3 } });
    await prisma.usageCounter.create({ data: { orgId: A.orgId, metric: "sends", periodKey: dayKey(now), count: 4 } });
    await as(A);
    const u = await getPlanUsage(now);
    expect(u.trialing).toBe(true);
    expect(u.planKey).toBe("zz-065b");
    expect(u.byMetric.campaigns).toMatchObject({ used: 1, limit: 2 });
    expect(u.byMetric.whatsapp).toMatchObject({ used: 0, limit: 1 });
    expect(u.byMetric.email_accounts).toMatchObject({ used: 0, limit: 1 });
    expect(u.byMetric.leads).toMatchObject({ used: 3, limit: 5, scope: "durante o teste" });
    expect(u.byMetric.sends).toMatchObject({ used: 4, limit: 10 });
    expect(u.items).toHaveLength(5);
  });
  it("plano pago: janela de leads e o mes; sem Subscription = tudo ilimitado", async () => {
    await setOrgPlan(B.orgId, { planKey: "zz-065b", status: "active", trialEndsAt: null });
    await as(B);
    const paid = await getPlanUsage();
    expect(paid.trialing).toBe(false);
    expect(paid.byMetric.leads.scope).toBe("neste mês");
    await prisma.subscription.deleteMany({ where: { orgId: B.orgId } });
    const none = await getPlanUsage();
    expect(none.items.every((i) => i.limit === null)).toBe(true);
  });
  it("isolamento: o uso de A nao aparece em B; trial expirado barra a leitura (fail-closed)", async () => {
    await setTrial(A.orgId, "zz-065b");
    await setTrial(B.orgId, "zz-065b");
    await prisma.usageCounter.create({ data: { orgId: A.orgId, metric: "leads", periodKey: "trial", count: 5 } });
    await as(B);
    expect((await getPlanUsage()).byMetric.leads.used).toBe(0);
    await setTrial(B.orgId, "zz-065b", true);
    await expect(getPlanUsage()).rejects.toBeInstanceOf(TrialExpiredError);
  });
});

describe("getBillingSummary / getOrgBannerState no bloqueio (allowlist)", () => {
  it("expirado: abre; dono ve ownerName=ele mesmo, membro ve o nome do dono; trialNeverGranted so quando nasceu expirado", async () => {
    // trial concedido de verdade: org criada ha 15 dias, `trialEndsAt` = criacao + 14 dias (ja passou)
    const created = new Date(Date.now() - 15 * DAY);
    await prisma.organization.update({ where: { id: A.orgId }, data: { createdAt: created } });
    await setOrgPlan(A.orgId, { planKey: "zz-065b", status: "trialing", trialEndsAt: new Date(created.getTime() + 14 * DAY) });
    await as(A);
    const owner = await getBillingSummary();
    expect(owner).toMatchObject({ isOwner: true, trialNeverGranted: false });
    expect(owner.ownerName).toContain("zz-065b-a user");
    await signInAs(memberId, { orgId: A.orgId, platformRole: "provider" });
    const member = await getBillingSummary();
    expect(member).toMatchObject({ isOwner: false, trialNeverGranted: false });
    expect(member.ownerName).toBe(owner.ownerName);
    // nasceu expirado (anti-abuso): trialEndsAt == criacao da organizacao
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: A.orgId }, select: { createdAt: true } });
    await setOrgPlan(A.orgId, { planKey: "zz-065b", status: "trialing", trialEndsAt: org.createdAt });
    await as(A);
    expect((await getBillingSummary()).trialNeverGranted).toBe(true);
    // regressao (QA M1): trial concedido que expirou ha 1 hora NAO e "ja usou o teste"
    const created2 = new Date(Date.now() - 14 * DAY - 3600_000);
    await prisma.organization.update({ where: { id: A.orgId }, data: { createdAt: created2 } });
    await setOrgPlan(A.orgId, { planKey: "zz-065b", status: "trialing", trialEndsAt: new Date(Date.now() - 3600_000) });
    expect((await getBillingSummary()).trialNeverGranted).toBe(false);
    // nasceu expirado com poucos segundos de diferenca (mesma transacao) continua true
    await prisma.organization.update({ where: { id: A.orgId }, data: { createdAt: new Date(Date.now() - 5 * DAY) } });
    await setOrgPlan(A.orgId, { planKey: "zz-065b", status: "trialing", trialEndsAt: new Date(Date.now() - 5 * DAY - 2000) });
    expect((await getBillingSummary()).trialNeverGranted).toBe(true);
  });
  it("getOrgBannerState expoe trialEndsAt e status da assinatura (chip/banner)", async () => {
    const ends = new Date(Date.now() + 2 * DAY);
    await setOrgPlan(A.orgId, { planKey: "zz-065b", status: "trialing", trialEndsAt: ends });
    await as(A);
    const s = await getOrgBannerState();
    expect(s).toMatchObject({ status: "active", trialExpired: false, subscriptionStatus: "trialing" });
    expect(s?.trialEndsAt?.getTime()).toBe(ends.getTime());
    await setOrgPlan(A.orgId, { planKey: "zz-065b", status: "active", trialEndsAt: null });
    expect((await getOrgBannerState())?.subscriptionStatus).toBe("active");
  });
});

describe("getDashboardOnboarding (cartoes do dashboard)", () => {
  it("nome automatico, dono x membro, passos feitos por organizacao", async () => {
    await prisma.campaign.deleteMany({ where: { orgId: A.orgId } }); // sobras dos testes anteriores
    await setTrial(A.orgId, "zz-065b");
    await setTrial(B.orgId, "zz-065b");
    await prisma.organization.update({ where: { id: A.orgId }, data: { name: "Empresa de Ana" } });
    await prisma.organization.update({ where: { id: B.orgId }, data: { name: "Minha Empresa Ltda" } });
    await as(A);
    const empty = await getDashboardOnboarding();
    expect(empty).toMatchObject({ orgId: A.orgId, orgName: "Empresa de Ana", isOwner: true, hasDefaultName: true, steps: { channel: false, campaign: false, leads: false } });
    await mkCampaign(A, "paused");
    await prisma.whatsAppInstance.create({ data: { orgId: A.orgId, instanceName: `zz065b-${randomUUID().slice(0, 8)}`, number: "5511912345678", webhookToken: randomUUID() } });
    expect((await getDashboardOnboarding()).steps).toEqual({ channel: true, campaign: true, leads: false });
    await signInAs(memberId, { orgId: A.orgId, platformRole: "provider" });
    expect((await getDashboardOnboarding()).isOwner).toBe(false);
    await as(B);
    const b = await getDashboardOnboarding();
    expect(b).toMatchObject({ hasDefaultName: false, steps: { channel: false, campaign: false, leads: false } });
    await prisma.whatsAppInstance.deleteMany({ where: { orgId: A.orgId } });
  });
});
