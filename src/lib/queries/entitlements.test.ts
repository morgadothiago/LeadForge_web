import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { signInAs, signOut } from "@/lib/auth/test-helpers";
import { purgeTestOrg } from "@/lib/test-utils/org-fixture";
import { mkCampaign } from "@/lib/test-utils/trial-fixture";
import { asOwner, changePlan, mkPlanOrg, uniq, type PlanOrg } from "@/lib/test-utils/entitlements-fixture";
import { UnauthorizedError } from "@/lib/auth/require-user";
import { getAiBudget, getAiBudgetAlert, getExtraUsage, getTenantEntitlements } from "./entitlements";

/** SPEC-069d — leituras do tenant (so leitura): plano efetivo, medidores extras e aviso de teto de IA (80%/100%), com isolamento por organizacao. */
const orgs: PlanOrg[] = [];
let memberId = "";
const mk = async (tag: string, plan: string, opts: Parameters<typeof mkPlanOrg>[2] = {}) => {
  const o = await mkPlanOrg(tag, plan, opts);
  orgs.push(o);
  return o;
};
const spend = async (o: PlanOrg, cents: number) => {
  const a = await prisma.agent.create({ data: { orgId: o.orgId, role: "followup", name: `zz069d-${uniq()}`, active: false, monthlyBudgetCents: 100000, allowedTools: [] } });
  const camp = await mkCampaign(o);
  const lead = await prisma.lead.create({ data: { campaignId: camp, name: "Ana", company: "Acme", email: `l-${uniq()}@zz069d.com`, phone: `+5511${String(910000000 + Math.floor(Math.random() * 8e7))}`, sequenceStatus: "active" } });
  await prisma.agentRun.create({ data: { agentId: a.id, leadId: lead.id, trigger: `step-${Math.random()}`, status: "running", costMicros: cents * 10_000 } });
  return a;
};

afterEach(() => signOut());
afterAll(async () => {
  if (memberId) {
    await prisma.membership.deleteMany({ where: { userId: memberId } });
    await prisma.user.deleteMany({ where: { id: memberId } });
  }
  for (const o of orgs) await purgeTestOrg(o);
});
beforeAll(() => {
  memberId = randomUUID();
});

describe("getTenantEntitlements", () => {
  it("Starter: features e limites efetivos; owner x member; sem segredo/data crua", async () => {
    const o = await mk("069d-st", "starter");
    await prisma.user.create({ data: { id: memberId, name: "zz membro", email: `zz-069d-m-${memberId.slice(0, 8)}@test.local`, role: "provider" } });
    await prisma.membership.create({ data: { userId: memberId, orgId: o.orgId, orgRole: "member" } });
    await asOwner(o);
    const v = await getTenantEntitlements();
    expect(v).toMatchObject({ planKey: "starter", planName: "Starter", source: "plan", paused: false, costlyBlocked: false, isOwner: true });
    expect(v.features["agents.role.followup"]).toBe(true);
    expect(v.features["agents.role.closer"]).toBe(false);
    expect(v.limits.maxActiveAgents).toBe(1);
    expect(typeof v.overrideExpiresAt === "string" || v.overrideExpiresAt === null).toBe(true);
    await signInAs(memberId, { orgId: o.orgId, platformRole: "provider" });
    expect((await getTenantEntitlements()).isOwner).toBe(false);
  });

  it("upgrade/downgrade valem na hora (sem cache entre requests); past_due pausa IA", async () => {
    const o = await mk("069d-dg", "pro");
    await asOwner(o);
    expect((await getTenantEntitlements()).features["agents.role.closer"]).toBe(true);
    await changePlan(o, "starter");
    expect((await getTenantEntitlements()).features["agents.role.closer"]).toBe(false);
    await changePlan(o, "pro", "past_due");
    const v = await getTenantEntitlements();
    expect(v.paused).toBe(true);
    expect(v.costlyBlocked).toBe(true);
    expect(v.features["agents.role.followup"]).toBe(false);
  });

  it("exige sessao (sem login = nao autenticado)", async () => {
    signOut();
    await expect(getTenantEntitlements()).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("getExtraUsage e getAiBudget (isolamento por org)", () => {
  it("conta agentes ativos, membros e custo de IA SO da propria org", async () => {
    const a = await mk("069d-ua", "pro");
    const b = await mk("069d-ub", "pro");
    const ag = await spend(a, 1500);
    await prisma.agent.update({ where: { id: ag.id }, data: { active: true } });
    await spend(b, 9000); // gasto de outra org nunca aparece em A
    await asOwner(a);
    const items = await getExtraUsage();
    const by = Object.fromEntries(items.map((i) => [i.metric, i]));
    expect(by.agents).toMatchObject({ used: 1, limit: 3 });
    expect(by.ai_budget).toMatchObject({ used: 1500, limit: 20000, unit: "brl_cents" });
    expect(by.members).toMatchObject({ used: 1, limit: 10 });
    expect(by.creatives).toMatchObject({ used: 0, limit: 20 });
    const ai = await getAiBudget();
    expect(ai).toMatchObject({ spentCents: 1500, capCents: 20000, state: "ok" });
  });

  it("Free: IA e criativos nao incluidos (limite 0)", async () => {
    const o = await mk("069d-free", "free");
    await asOwner(o);
    const by = Object.fromEntries((await getExtraUsage()).map((i) => [i.metric, i]));
    expect(by.agents.limit).toBe(0);
    expect(by.creatives.limit).toBe(0);
    expect((await getAiBudget()).state).toBe("not_included");
  });
});

describe("getAiBudgetAlert: aviso ao PROPRIETARIO em 80% e 100%", () => {
  it("abaixo de 80% = nada; 80% = alert; 100% = exhausted; member nunca recebe; Free/sem teto = nada", async () => {
    const o = await mk("069d-al", "starter"); // teto R$ 50,00 = 5000 centavos
    await asOwner(o);
    expect(await getAiBudgetAlert()).toBeNull();
    await spend(o, 3900); // 78%
    expect(await getAiBudgetAlert()).toBeNull();
    await spend(o, 100); // 80%
    expect(await getAiBudgetAlert()).toMatchObject({ state: "alert", spentCents: 4000, capCents: 5000 });
    await spend(o, 1000); // 100%
    expect(await getAiBudgetAlert()).toMatchObject({ state: "exhausted" });
    // member da mesma org nao recebe o aviso
    const mid = randomUUID();
    await prisma.user.create({ data: { id: mid, name: "zz m2", email: `zz-069d-m2-${mid.slice(0, 8)}@test.local`, role: "provider" } });
    await prisma.membership.create({ data: { userId: mid, orgId: o.orgId, orgRole: "member" } });
    await signInAs(mid, { orgId: o.orgId, platformRole: "provider" });
    expect(await getAiBudgetAlert()).toBeNull();
    await prisma.membership.deleteMany({ where: { userId: mid } });
    await prisma.user.deleteMany({ where: { id: mid } });
    // Free: sem IA no plano = sem aviso
    const f = await mk("069d-al-free", "free");
    await asOwner(f);
    expect(await getAiBudgetAlert()).toBeNull();
  });

  it("upgrade para Pro (teto maior) tira o aviso na hora", async () => {
    const o = await mk("069d-al-up", "starter");
    await spend(o, 5000);
    await asOwner(o);
    expect(await getAiBudgetAlert()).toMatchObject({ state: "exhausted" });
    await changePlan(o, "pro"); // R$ 200: 5000/20000 = 25%
    expect(await getAiBudgetAlert()).toBeNull();
  });
});
