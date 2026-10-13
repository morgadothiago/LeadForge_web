import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.LEAD_SEARCH_ENABLED = "true";

import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { signInAs, signOut } from "@/lib/auth/test-helpers";
import { encrypt } from "@/lib/crypto/secret-box";
import { purgeTestOrg } from "@/lib/test-utils/org-fixture";
import { mkCampaign } from "@/lib/test-utils/trial-fixture";
import { asOwner, changePlan, ensureGarbagePlan, errCode, mkPlanOrg, uniq, type PlanOrg } from "@/lib/test-utils/entitlements-fixture";
import { getEntitlements, isCostlyBlocked } from "./entitlements";
import { getOrgLimits } from "./limits";
import { createAgent, setAgentActive, updateAgent, updateAgentSettings } from "@/lib/actions/agent";
import { createCampaign } from "@/lib/actions/campaign";
import { createEmailAccount } from "@/lib/actions/email";
import { createLead } from "@/lib/actions/lead";
import { removeIntegration, saveIntegration } from "@/lib/actions/integration";
import { approveDraftMobile, setKillSwitch } from "@/lib/mobile/actions";
import { _setCacheTtl, findIntegrationConfig, integrationOrigin, invalidateIntegrationCache } from "@/lib/integrations/config";
import { getLlmProvider } from "@/lib/agents/provider";
import { runLeadSearch } from "@/lib/lead-search/run";
import type { LeadSource } from "@/lib/lead-search/types";
import { clearOrgRateLimits } from "@/lib/org/rate-limit";
import { mkIcp } from "@/lib/test-utils/trial-fixture";

/**
 * SPEC-069c (backend) — regressoes dos achados do QA 069b (1 a 6) e a inversao de papeis (tenant so le a POLITICA).
 * As actions de admin tem o proprio arquivo (`src/lib/actions/admin/entitlements.test.ts`).
 */
const orgs: PlanOrg[] = [];
const mk = async (tag: string, plan: string, opts: Parameters<typeof mkPlanOrg>[2] = {}) => {
  const o = await mkPlanOrg(tag, plan, opts);
  orgs.push(o);
  return o;
};
const savedEnv = { k: process.env.PLATFORM_LLM_API_KEY, u: process.env.PLATFORM_LLM_BASE_URL };

beforeAll(() => clearOrgRateLimits());
afterEach(() => {
  signOut();
  clearOrgRateLimits();
  _setCacheTtl(null);
  invalidateIntegrationCache();
  for (const [name, v] of [["PLATFORM_LLM_API_KEY", savedEnv.k], ["PLATFORM_LLM_BASE_URL", savedEnv.u]] as const) {
    if (v === undefined) delete process.env[name];
    else process.env[name] = v;
  }
});
afterAll(async () => {
  for (const o of orgs) {
    await prisma.draft.deleteMany({ where: { lead: { campaign: { orgId: o.orgId } } } });
    await prisma.agentRun.deleteMany({ where: { agent: { orgId: o.orgId } } });
    await prisma.agent.deleteMany({ where: { orgId: o.orgId } });
    await prisma.agentSettings.deleteMany({ where: { orgId: o.orgId } });
    await prisma.orgEntitlementOverride.deleteMany({ where: { orgId: o.orgId } });
    await prisma.integrationSecret.deleteMany({ where: { orgId: o.orgId } });
    await prisma.integrationAuditLog.deleteMany({ where: { orgId: o.orgId } });
    await prisma.mobileActionLog.deleteMany({ where: { userId: o.userId } });
    await prisma.membership.deleteMany({ where: { orgId: o.orgId, orgRole: "member" } });
    await prisma.emailAccount.deleteMany({ where: { orgId: o.orgId } });
    await purgeTestOrg(o);
  }
});

// -------------------------------------------------------------------------------------------------------------------------------
describe("achado 1: approveDraftMobile mapeia o bloqueio de plano (nunca 500)", () => {
  it("Free (sem agente no plano): 403 plan_feature_locked com mensagem PT-BR; o rascunho nao e consumido", async () => {
    const o = await mk("mob-appr", "free");
    const agent = await prisma.agent.create({ data: { orgId: o.orgId, role: "followup", name: `zz069c-${uniq()}`, active: true, monthlyBudgetCents: 1000, allowedTools: [] } });
    const camp = await mkCampaign(o);
    const lead = await prisma.lead.create({ data: { campaignId: camp, name: "Ana", email: `a-${uniq()}@zz069c.com`, phone: "+5511987654321", sequenceStatus: "active" } });
    const run = await prisma.agentRun.create({ data: { agentId: agent.id, leadId: lead.id, trigger: `t-${uniq()}`, status: "completed" } });
    const draft = await prisma.draft.create({ data: { agentRunId: run.id, leadId: lead.id, channel: "whatsapp", body: "Olá! Posso ajudar?" } });
    const r = await approveDraftMobile({ userId: o.userId, deviceId: "dev-x" } as never, draft.id);
    expect(r).toMatchObject({ ok: false, status: 403, code: "plan_feature_locked" });
    if (!r.ok) expect(r.message).toMatch(/plano/i);
    expect((await prisma.draft.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("pending");
  });
});

describe("achado 2: setKillSwitch mobile aplica o guard de plano e a trava do admin", () => {
  const dev = { deviceId: "dev-ks" };
  const withPassword = async (o: PlanOrg) => {
    await prisma.user.update({ where: { id: o.userId }, data: { passwordHash: await hashPassword("Senha-Forte-123") } });
    return { userId: o.userId, ...dev } as never;
  };
  it("Free: desligar o kill switch (ligar a IA) = 403 plan_feature_locked, ANTES de pedir senha; ligar (parar tudo) sempre livre", async () => {
    const o = await mk("mob-ks-free", "free");
    const a = await withPassword(o);
    expect(await setKillSwitch(a, false, "Senha-Forte-123")).toMatchObject({ ok: false, status: 403, code: "plan_feature_locked" });
    expect(await setKillSwitch(a, false, undefined)).toMatchObject({ ok: false, code: "plan_feature_locked" });
    expect(await setKillSwitch(a, true, undefined)).toMatchObject({ ok: true });
    expect((await prisma.agentSettings.findUniqueOrThrow({ where: { orgId: o.orgId } })).killSwitch).toBe(true);
  });
  it("Pro: com senha liga a IA; travado pelo admin (lockedByAdmin) = 403 policy_locked e nada muda", async () => {
    const o = await mk("mob-ks-pro", "pro");
    const a = await withPassword(o);
    await prisma.agentSettings.create({ data: { orgId: o.orgId, killSwitch: true, lockedByAdmin: true } });
    expect(await setKillSwitch(a, false, "Senha-Forte-123")).toMatchObject({ ok: false, status: 403, code: "policy_locked" });
    expect((await prisma.agentSettings.findUniqueOrThrow({ where: { orgId: o.orgId } })).killSwitch).toBe(true);
    await prisma.agentSettings.update({ where: { orgId: o.orgId }, data: { lockedByAdmin: false } });
    expect(await setKillSwitch(a, false, "Senha-Forte-123")).toMatchObject({ ok: true });
    expect((await prisma.agentSettings.findUniqueOrThrow({ where: { orgId: o.orgId } })).killSwitch).toBe(false);
    // o tenant PODE ligar mesmo travado (emergencia)
    await prisma.agentSettings.update({ where: { orgId: o.orgId }, data: { lockedByAdmin: true } });
    expect(await setKillSwitch(a, true, undefined)).toMatchObject({ ok: true });
  });
});

// -------------------------------------------------------------------------------------------------------------------------------
describe("achado 3: Business/courtesy em past_due tambem pausam IA e envio automatico (D-069-10)", () => {
  for (const plan of ["business", "courtesy"] as const) {
    it(`${plan} em dia: tudo liberado; past_due: IA pausada, caixa/leitura seguem, limites de IA = 0`, async () => {
      const ok = await mk(`pd-ok-${plan}`, plan);
      const e1 = await getEntitlements(prisma, ok.orgId);
      expect(e1.paused).toBe(false);
      expect(e1.features["agents.role.closer"]).toBe(true);
      expect(e1.limits.maxActiveAgents).toBeNull();

      const late = await mk(`pd-late-${plan}`, plan, { status: "past_due" });
      const e2 = await getEntitlements(prisma, late.orgId);
      expect(e2.source).toBe("full");
      expect(e2.paused).toBe(true);
      expect(isCostlyBlocked(e2)).toBe(true);
      for (const k of ["agents.role.sdr", "agents.role.followup", "agents.role.closer", "agents.autonomy.auto", "llm.byok"] as const) expect(e2.features[k], k).toBe(false);
      expect(e2.features["inbox.reply"]).toBe(true); // nao custam dinheiro
      expect(e2.limits.maxActiveAgents).toBe(0);
      expect(e2.limits.maxAiBudgetCentsMonth).toBe(0);
      expect(e2.limits.maxAgentMessagesPerDay).toBe(0);
      const ag = await prisma.agent.create({ data: { orgId: late.orgId, role: "followup", name: `zz069c-${uniq()}`, active: false, monthlyBudgetCents: 1000, allowedTools: [] } });
      await asOwner(late);
      expect(errCode(await setAgentActive({ id: ag.id, active: true }))).toBe("plan_feature_locked");
      // regularizou: volta sozinho
      await changePlan(late, plan, "active");
      expect((await getEntitlements(prisma, late.orgId)).paused).toBe(false);
    });
  }
});

describe("achado 4: plano ilegivel = fail-closed tambem nos limites legados (criacao)", () => {
  it("getEntitlements/getOrgLimits: org inexistente e plano ilegivel => todos os limites 0 (campanhas, WhatsApp, e-mail, leads, envios)", async () => {
    const ghost = await getEntitlements(prisma, randomUUID());
    expect(ghost.source).toBe("error");
    for (const k of ["maxCampaigns", "maxWhatsappInstances", "maxEmailAccounts", "maxLeadsPerMonth", "maxSendsPerDay", "maxMembers", "maxSequenceSteps"] as const) expect(ghost.limits[k], k).toBe(0);
    const o = await mk("fc-lim", "starter");
    await ensureGarbagePlan();
    await changePlan(o, "zz-069b-garbage", "active");
    const l = await getOrgLimits(prisma, o.orgId);
    expect([l.maxCampaigns, l.maxWhatsappInstances, l.maxEmailAccounts, l.maxLeadsPerMonth, l.maxSendsPerDay]).toEqual([0, 0, 0, 0, 0]);
  });
  it("criar campanha / conta de e-mail / lead com plano ilegivel => plan_limit (limite 0); org sem assinatura e plano valido seguem livres", async () => {
    const o = await mk("fc-create", "starter");
    const camp = await mkCampaign(o); // criada antes (plano valido)
    const icp = await mkIcp(o);
    await ensureGarbagePlan();
    await changePlan(o, "zz-069b-garbage", "active");
    await asOwner(o);
    expect(errCode(await createCampaign({ name: `zz069c-${uniq()}`, icpId: icp, status: "active" }))).toBe("plan_limit");
    expect(errCode(await createEmailAccount({ provider: "smtp", smtpHost: "smtp.example.com", port: 587, email: `zz069c-${uniq()}@example.com`, password: "x" }))).toBe("plan_limit");
    expect(errCode(await createLead({ campaignId: camp, name: "Fulano", email: `zz069c-${uniq()}@example.com` }))).toBe("plan_limit");
    // volta ao plano valido: cria normalmente (nada foi apagado)
    await changePlan(o, "starter", "active");
    expect((await createCampaign({ name: `zz069c-${uniq()}`, icpId: icp, status: "paused" })).ok).toBe(true);
  });
});

// -------------------------------------------------------------------------------------------------------------------------------
describe("achado 5: chaves de LLM (BYOK) salvas por tenants ficam DESATIVADAS sem llm.byok", () => {
  const putLlm = (orgId: string, over: Record<string, unknown> = {}) =>
    prisma.integrationSecret.upsert({
      where: { orgId_integration_name: { orgId, integration: "llm", name: "default" } },
      create: { orgId, integration: "llm", name: "default", encryptedValue: encrypt("sk-tenant-legacy-1234"), hint: "1234", ...over },
      update: { encryptedValue: encrypt("sk-tenant-legacy-1234"), hint: "1234", ...over },
    });
  it("Starter/Pro com chave propria (legado): nao e usada; sem chave da plataforma = nao configurada; origem 'none'", async () => {
    delete process.env.PLATFORM_LLM_API_KEY;
    delete process.env.PLATFORM_LLM_BASE_URL;
    for (const plan of ["starter", "pro"]) {
      const o = await mk(`byok-${plan}`, plan);
      await putLlm(o.orgId);
      expect(await findIntegrationConfig(o.orgId, "llm")).toBeNull();
      expect(await integrationOrigin(o.orgId, "llm")).toBe("none");
      await expect(getLlmProvider(o.orgId)).rejects.toMatchObject({ code: "config" });
    }
  });
  it("com LLM da plataforma (env): a chave do tenant e ignorada e a da plataforma assume (origem env)", async () => {
    process.env.PLATFORM_LLM_API_KEY = "sk-platform-9999-abcdefgh";
    const o = await mk("byok-env", "pro");
    await putLlm(o.orgId);
    const cfg = await findIntegrationConfig(o.orgId, "llm");
    expect(cfg?.origin).toBe("env");
    expect(cfg?.reveal()).toBe("sk-platform-9999-abcdefgh");
    expect(JSON.stringify(cfg)).not.toContain("sk-platform");
    expect(await integrationOrigin(o.orgId, "llm")).toBe("env");
  });
  it("chave da PLATAFORMA gravada pelo admin (managedByPlatform) vale em qualquer plano; BYOK volta com Business ou override llm.byok (sem cache de plano)", async () => {
    delete process.env.PLATFORM_LLM_API_KEY;
    const managed = await mk("byok-managed", "starter");
    await putLlm(managed.orgId, { managedByPlatform: true });
    expect((await findIntegrationConfig(managed.orgId, "llm"))?.origin).toBe("db");

    const pro = await mk("byok-ov", "pro");
    await putLlm(pro.orgId);
    _setCacheTtl(60_000);
    expect(await findIntegrationConfig(pro.orgId, "llm")).toBeNull();
    await prisma.orgEntitlementOverride.create({ data: { orgId: pro.orgId, features: { "llm.byok": true }, limits: {}, reason: "piloto", createdBy: "t" } });
    expect((await findIntegrationConfig(pro.orgId, "llm"))?.reveal()).toBe("sk-tenant-legacy-1234"); // vale na hora, mesmo com cache do segredo
    await prisma.orgEntitlementOverride.delete({ where: { orgId: pro.orgId } });
    expect(await findIntegrationConfig(pro.orgId, "llm")).toBeNull(); // o direito saiu: desativa de novo (a chave NAO foi apagada)
    expect(await prisma.integrationSecret.count({ where: { orgId: pro.orgId, integration: "llm" } })).toBe(1);

    const biz = await mk("byok-biz", "business");
    await putLlm(biz.orgId);
    expect((await findIntegrationConfig(biz.orgId, "llm"))?.origin).toBe("db");
  });
  it("isolamento: a chave do tenant A nunca resolve para a org B", async () => {
    delete process.env.PLATFORM_LLM_API_KEY;
    const a = await mk("byok-iso-a", "business");
    const b = await mk("byok-iso-b", "business");
    await putLlm(a.orgId);
    expect(await findIntegrationConfig(b.orgId, "llm")).toBeNull();
  });
});

// -------------------------------------------------------------------------------------------------------------------------------
describe("achado 6: buscas AGENDADAS tambem serializam o teto da org (lock)", () => {
  const source = (): LeadSource => ({ id: "google_places", search: vi.fn(async () => ({ leads: [], requests: 1 })) });
  it("2 campanhas da mesma org, teto 1/dia (override): 2 buscas agendadas em paralelo => exatamente 1 run; a outra pula", async () => {
    const o = await mk("sched-lock", "pro");
    await prisma.orgEntitlementOverride.create({ data: { orgId: o.orgId, features: {}, limits: { maxLeadSearchesPerDay: 1 }, reason: "t", createdBy: "t" } });
    const camps = [await mkCampaign(o), await mkCampaign(o)];
    const res = await Promise.allSettled(camps.map((c) => runLeadSearch(c, { trigger: "scheduled", source: source() })));
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(res.filter((r) => r.status === "rejected")).toHaveLength(1); // a agendada pulada vira "conflict" no wrapper (runDailySearch ignora em silencio)
    expect(await prisma.searchRun.count({ where: { campaign: { orgId: o.orgId }, status: { not: "blocked" } } })).toBe(1);
  });
});

// -------------------------------------------------------------------------------------------------------------------------------
describe("tenant SOMENTE LEITURA na politica de agentes (AC-2)", () => {
  const mkMember = async (o: PlanOrg) => {
    const id = randomUUID();
    await prisma.user.create({ data: { id, name: "zz069c member", email: `zz069c-m-${id.slice(0, 8)}@test.local`, role: "provider", emailVerifiedAt: new Date() } });
    await prisma.membership.create({ data: { userId: id, orgId: o.orgId, orgRole: "member" } });
    return id;
  };
  const policyRefused = (r: { ok: boolean; errors?: Record<string, string[]> }, field: string) => {
    expect(r.ok).toBe(false);
    expect(errCode(r)).toBe("policy_admin_only");
    expect(r.errors?.fields).toContain(field);
    expect(r.errors?._form?.[0]).toMatch(/Definido pela plataforma/);
  };

  it("owner e member: mudar modelo/teto/msgs por dia/turnos de um agente e recusado (valores intactos); persona/objetivo/tom seguem editaveis; reenviar o mesmo valor passa", async () => {
    const o = await mk("pol-agent", "pro");
    const memberId = await mkMember(o);
    const a = await prisma.agent.create({ data: { orgId: o.orgId, role: "followup", name: `zz069c-${uniq()}`, monthlyBudgetCents: 5000, dailyMessageLimit: 30, maxTurnsPerLead: 4, model: "claude-haiku-4-5", allowedTools: [] } });
    for (const who of ["owner", "member"] as const) {
      if (who === "owner") await asOwner(o);
      else await signInAs(memberId, { orgId: o.orgId, platformRole: "provider" });
      policyRefused(await updateAgent({ id: a.id, model: "claude-opus-4-1" }), "model");
      policyRefused(await updateAgent({ id: a.id, monthlyBudgetCents: 9_999_00 }), "monthlyBudgetCents");
      policyRefused(await updateAgent({ id: a.id, dailyMessageLimit: 500 }), "dailyMessageLimit");
      policyRefused(await updateAgent({ id: a.id, maxTurnsPerLead: 50 }), "maxTurnsPerLead");
      policyRefused(await updateAgent({ id: a.id, name: "Novo nome", monthlyBudgetCents: null }), "monthlyBudgetCents"); // misturado com conteudo: nada e gravado
      const cur = await prisma.agent.findUniqueOrThrow({ where: { id: a.id } });
      expect([cur.model, cur.monthlyBudgetCents, cur.dailyMessageLimit, cur.maxTurnsPerLead]).toEqual(["claude-haiku-4-5", 5000, 30, 4]);
      expect(cur.name).toBe(a.name);
    }
    await asOwner(o);
    // conteudo + politica IGUAL a gravada (a tela atual reenvia o formulario inteiro) = ok
    const ok = await updateAgent({ id: a.id, persona: "Persona nova", objective: "Objetivo novo", tone: "amigavel", model: "claude-haiku-4-5", monthlyBudgetCents: 5000, dailyMessageLimit: 30, maxTurnsPerLead: 4 });
    expect(ok.ok).toBe(true);
    expect((await prisma.agent.findUniqueOrThrow({ where: { id: a.id } })).persona).toBe("Persona nova");
  });
  it("createAgent: nasce com a politica padrao; pedir modelo/teto/limites diferentes e recusado e nada e criado", async () => {
    const o = await mk("pol-create", "pro");
    await asOwner(o);
    policyRefused(await createAgent({ name: `zz069c-${uniq()}`, role: "sdr", monthlyBudgetCents: 100_00 }), "monthlyBudgetCents");
    policyRefused(await createAgent({ name: `zz069c-${uniq()}`, role: "sdr", model: "outro-modelo", dailyMessageLimit: 400 }), "model");
    expect(await prisma.agent.count({ where: { orgId: o.orgId } })).toBe(0);
    const ok = await createAgent({ name: `zz069c-${uniq()}`, role: "sdr", persona: "x" });
    expect(ok.ok).toBe(true);
    const created = await prisma.agent.findFirstOrThrow({ where: { orgId: o.orgId } });
    expect([created.model, created.monthlyBudgetCents, created.dailyMessageLimit, created.maxTurnsPerLead]).toEqual(["claude-haiku-4-5", null, 20, 5]);
    // sem teto definido pelo admin o agente nao ativa (padrao desligado)
    expect(errCode(await setAgentActive({ id: created.id, active: true }))).toBeUndefined();
    expect((await setAgentActive({ id: created.id, active: true })).ok).toBe(false);
  });
  it("updateAgentSettings: teto da org e politica; kill switch LIGAR sempre pode; DESLIGAR travado pelo admin e recusado (Q-069-3); destravado desliga", async () => {
    const o = await mk("pol-settings", "pro");
    await prisma.agentSettings.create({ data: { orgId: o.orgId, killSwitch: true, lockedByAdmin: true, monthlyBudgetCents: 20_000 } });
    await asOwner(o);
    policyRefused(await updateAgentSettings({ monthlyBudgetCents: 999_999 }), "monthlyBudgetCents");
    policyRefused(await updateAgentSettings({ monthlyBudgetCents: null }), "monthlyBudgetCents");
    policyRefused(await updateAgentSettings({ killSwitch: false }), "killSwitch");
    let s = await prisma.agentSettings.findUniqueOrThrow({ where: { orgId: o.orgId } });
    expect([s.killSwitch, s.lockedByAdmin, s.monthlyBudgetCents]).toEqual([true, true, 20_000]);
    // ligar (emergencia) e reenviar o mesmo teto: livre; a trava continua do admin
    expect((await updateAgentSettings({ killSwitch: true, monthlyBudgetCents: 20_000 })).ok).toBe(true);
    s = await prisma.agentSettings.findUniqueOrThrow({ where: { orgId: o.orgId } });
    expect(s.lockedByAdmin).toBe(true);
    await prisma.agentSettings.update({ where: { orgId: o.orgId }, data: { lockedByAdmin: false } });
    expect((await updateAgentSettings({ killSwitch: false })).ok).toBe(true);
    // o tenant nunca consegue gravar `lockedByAdmin` (campo ignorado pelo schema)
    await updateAgentSettings({ killSwitch: true, lockedByAdmin: false } as never);
    await prisma.agentSettings.update({ where: { orgId: o.orgId }, data: { lockedByAdmin: true } });
    await updateAgentSettings({ killSwitch: true, lockedByAdmin: false } as never);
    expect((await prisma.agentSettings.findUniqueOrThrow({ where: { orgId: o.orgId } })).lockedByAdmin).toBe(true);
  });
  it("org sem AgentSettings: kill switch padrao (ligado) e o tenant ainda pode ligar; teto novo e recusado", async () => {
    const o = await mk("pol-nosettings", "pro");
    await asOwner(o);
    policyRefused(await updateAgentSettings({ monthlyBudgetCents: 1000 }), "monthlyBudgetCents");
    expect((await updateAgentSettings({ killSwitch: true })).ok).toBe(true);
  });
});

describe("integracoes: chave da plataforma nao e do tenant (secao A)", () => {
  it("owner: evolution/places recusados com policy_admin_only (nada gravado); llm so com byok; n8n com ingest.api", async () => {
    const pro = await mk("int-pro", "pro");
    await asOwner(pro);
    for (const integration of ["places"] as const) {
      const r = await saveIntegration({ integration, value: "chave-de-teste-12345" });
      expect(errCode(r)).toBe("policy_admin_only");
      expect(!r.ok && r.errors?.fields).toContain("integration");
    }
    const evo = await saveIntegration({ integration: "evolution", value: "chave-de-teste-12345", baseUrl: "https://evo.exemplo.test" });
    expect(errCode(evo)).toBe("policy_admin_only");
    expect(errCode(await saveIntegration({ integration: "llm", value: "chave-de-teste-12345" }))).toBe("plan_feature_locked"); // BYOK desligado no Pro
    expect(await prisma.integrationSecret.count({ where: { orgId: pro.orgId } })).toBe(0);
    const biz = await mk("int-biz", "business");
    await asOwner(biz);
    expect((await saveIntegration({ integration: "llm", value: "chave-de-teste-12345" })).ok).toBe(true);
    expect(errCode(await saveIntegration({ integration: "places", value: "chave-de-teste-12345" }))).toBe("policy_admin_only"); // nem Business grava chave de plataforma
  });
  it("chave gravada pelo admin (managedByPlatform): o tenant nao edita nem remove, e a linha continua intacta", async () => {
    const biz = await mk("int-managed", "business");
    const row = await prisma.integrationSecret.create({ data: { orgId: biz.orgId, integration: "llm", name: "default", encryptedValue: encrypt("sk-platform-aaaa1111"), hint: "1111", managedByPlatform: true } });
    await asOwner(biz);
    expect(errCode(await saveIntegration({ integration: "llm", value: "outra-chave-de-teste-1" }))).toBe("policy_admin_only");
    expect(errCode(await removeIntegration({ id: row.id, confirm: true }))).toBe("policy_admin_only");
    const after = await prisma.integrationSecret.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.encryptedValue).toBe(row.encryptedValue);
    expect(after.managedByPlatform).toBe(true);
  });
});
