import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");

import { prisma } from "@/lib/prisma";
import { signInAs, signOut } from "@/lib/auth/test-helpers";
import { purgeTestOrg } from "@/lib/test-utils/org-fixture";
import { asOwner, mkPlanOrg, uniq, type PlanOrg } from "@/lib/test-utils/entitlements-fixture";
import { getEntitlements, hasFeature, limitOf } from "@/lib/billing/entitlements";
import { findIntegrationConfig } from "@/lib/integrations/config";
import { _setIntegrationResolver } from "@/lib/integrations/url-guard";
import { clearOverride, setOverride } from "@/lib/admin/org-policy";
import { getOrganizationPolicy } from "@/lib/queries/admin/org-policy";
import { updateAgentSettings } from "@/lib/actions/agent";
import {
  clearOrgEntitlementOverride, removeOrgIntegrationByAdmin, saveOrgIntegrationByAdmin, setAgentPolicyByAdmin, setOrgAgentSettingsByAdmin, setOrgEntitlementOverride,
} from "./entitlements";

/**
 * SPEC-069c (backend) — actions de POLITICA por organizacao: SO `platform_admin`; auditoria (quem/quando/antes/depois/motivo, sem segredo); override com motivo e validade;
 * isolamento A/B/C; trava do kill switch (`lockedByAdmin`); admin sem acesso operacional.
 */
const orgs: PlanOrg[] = [];
const mk = async (tag: string, plan = "starter") => {
  const o = await mkPlanOrg(tag, plan);
  orgs.push(o);
  return o;
};
let adminId = "";
const asAdmin = () => signInAs(adminId, { orgId: null, platformRole: "platform_admin" });
const REASON = "Cliente piloto aprovado pelo comercial";
const SECRET = "sk-super-secreto-QWERTY-wxyz";
const dump = (o: unknown) => JSON.stringify(o);
const logs: string[] = [];

beforeAll(async () => {
  adminId = randomUUID();
  await prisma.user.create({ data: { id: adminId, name: "zz069c admin", email: `zz069c-adm-${adminId.slice(0, 8)}@test.local`, role: "platform_admin" } });
  for (const m of ["log", "warn", "error", "info"] as const) vi.spyOn(console, m).mockImplementation((...a) => void logs.push(a.map(String).join(" ")));
});
afterEach(() => {
  signOut();
  _setIntegrationResolver(null);
});
afterAll(async () => {
  vi.restoreAllMocks();
  for (const o of orgs) {
    await prisma.platformAuditLog.deleteMany({ where: { orgId: o.orgId } });
    await prisma.orgAuditLog.deleteMany({ where: { orgId: o.orgId } });
    await prisma.orgEntitlementOverride.deleteMany({ where: { orgId: o.orgId } });
    await prisma.integrationSecret.deleteMany({ where: { orgId: o.orgId } });
    await prisma.integrationAuditLog.deleteMany({ where: { orgId: o.orgId } });
    await prisma.whatsAppInstance.deleteMany({ where: { orgId: o.orgId } });
    await prisma.agent.deleteMany({ where: { orgId: o.orgId } });
    await prisma.agentSettings.deleteMany({ where: { orgId: o.orgId } });
    await purgeTestOrg(o);
  }
  await prisma.user.deleteMany({ where: { id: adminId } });
});

// -------------------------------------------------------------------------------------------------------------------------------
describe("autorizacao: SO platform_admin (tenant owner/member/anonimo recusados; nada e gravado)", () => {
  const mkMember = async (o: PlanOrg) => {
    const id = randomUUID();
    await prisma.user.create({ data: { id, name: "zz069c member", email: `zz069c-m-${id.slice(0, 8)}@test.local`, role: "provider", emailVerifiedAt: new Date() } });
    await prisma.membership.create({ data: { userId: id, orgId: o.orgId, orgRole: "member" } });
    return id;
  };
  const calls = (orgId: string, agentId: string, integrationId: string) => ({
    setOrgEntitlementOverride: () => setOrgEntitlementOverride({ orgId, reason: REASON, features: { "agents.role.sdr": true } }),
    clearOrgEntitlementOverride: () => clearOrgEntitlementOverride({ orgId, reason: REASON }),
    setOrgAgentSettingsByAdmin: () => setOrgAgentSettingsByAdmin({ orgId, reason: REASON, killSwitch: false, lockedByAdmin: true, monthlyBudgetCents: 123_00 }),
    setAgentPolicyByAdmin: () => setAgentPolicyByAdmin({ orgId, agentId, reason: REASON, model: "modelo-invasor", monthlyBudgetCents: 99_999 }),
    saveOrgIntegrationByAdmin: () => saveOrgIntegrationByAdmin({ orgId, reason: REASON, integration: "places", value: SECRET }),
    removeOrgIntegrationByAdmin: () => removeOrgIntegrationByAdmin({ orgId, reason: REASON, id: integrationId }),
  });

  it("anonimo, owner e member (inclusive da PROPRIA org) sao recusados em TODA action; banco intacto", async () => {
    const o = await mk("authz", "pro");
    const memberId = await mkMember(o);
    const agent = await prisma.agent.create({ data: { orgId: o.orgId, role: "followup", name: `zz069c-${uniq()}`, monthlyBudgetCents: 5000, allowedTools: [] } });
    const sec = await prisma.integrationSecret.create({ data: { orgId: o.orgId, integration: "places", name: "default", encryptedValue: "v1:x", hint: "abcd", managedByPlatform: true } });
    await prisma.orgEntitlementOverride.create({ data: { orgId: o.orgId, features: {}, limits: { maxMembers: 7 }, reason: "inicial", createdBy: "t" } });
    const c = calls(o.orgId, agent.id, sec.id);
    for (const who of ["anon", "owner", "member"] as const) {
      signOut();
      if (who === "owner") await asOwner(o);
      if (who === "member") await signInAs(memberId, { orgId: o.orgId, platformRole: "provider" });
      for (const [name, fn] of Object.entries(c)) {
        const r = await fn();
        expect(r.ok, `${who} -> ${name}`).toBe(false);
        expect(!r.ok && r.errors._form?.[0], `${who} -> ${name}`).toMatch(/Sem permissão|Sessão expirada/);
      }
    }
    expect(await prisma.platformAuditLog.count({ where: { orgId: o.orgId } })).toBe(0);
    expect(await prisma.agentSettings.count({ where: { orgId: o.orgId } })).toBe(0);
    expect((await prisma.agent.findUniqueOrThrow({ where: { id: agent.id } })).model).toBe("claude-haiku-4-5");
    expect(await prisma.integrationSecret.count({ where: { orgId: o.orgId } })).toBe(1);
    expect((await prisma.orgEntitlementOverride.findUniqueOrThrow({ where: { orgId: o.orgId } })).reason).toBe("inicial");
    // a leitura da politica tambem e so do admin
    await asOwner(o);
    await expect(getOrganizationPolicy(o.orgId)).rejects.toThrow();
    signOut();
    await expect(getOrganizationPolicy(o.orgId)).rejects.toThrow();
  });

  it("platform_admin: cada action funciona (ver os testes abaixo) e a leitura da politica responde", async () => {
    const o = await mk("authz-ok");
    await asAdmin();
    const r = await setOrgEntitlementOverride({ orgId: o.orgId, reason: REASON, limits: { maxMembers: 9 } });
    expect(r.ok).toBe(true);
    const v = await getOrganizationPolicy(o.orgId);
    expect(v?.org.id).toBe(o.orgId);
    expect(v?.override?.limits).toEqual({ maxMembers: 9 });
    expect(v?.effective.limits.maxMembers).toBe(9);
    expect(await getOrganizationPolicy("nao-e-uuid")).toBeNull();
    expect(await getOrganizationPolicy(randomUUID())).toBeNull();
  });
});

// -------------------------------------------------------------------------------------------------------------------------------
describe("override: motivo obrigatorio, validade, validacao e auditoria", () => {
  it("valida entrada: motivo ausente/curto, funcionalidade/limite desconhecidos, valor invalido, vazio, validade passada ou invalida, org inexistente", async () => {
    const o = await mk("ov-val");
    await asAdmin();
    const base = { orgId: o.orgId, features: { "agents.role.sdr": true } };
    const noReason = await setOrgEntitlementOverride(base);
    expect(!noReason.ok && noReason.errors.reason?.[0]).toMatch(/motivo/i);
    const short = await setOrgEntitlementOverride({ ...base, reason: "abc" });
    expect(!short.ok && short.errors.reason?.[0]).toMatch(/ao menos 5/);
    const badFeature = await setOrgEntitlementOverride({ orgId: o.orgId, reason: REASON, features: { "plano.pro": true } });
    expect(!badFeature.ok && Object.keys(badFeature.errors).join()).toContain("features.plano.pro");
    const badLimit = await setOrgEntitlementOverride({ orgId: o.orgId, reason: REASON, limits: { maxQualquer: 3 } });
    expect(!badLimit.ok && Object.keys(badLimit.errors).join()).toContain("limits.maxQualquer");
    expect((await setOrgEntitlementOverride({ orgId: o.orgId, reason: REASON, limits: { maxMembers: -1 } })).ok).toBe(false);
    expect((await setOrgEntitlementOverride({ orgId: o.orgId, reason: REASON, limits: { maxMembers: 1.5 } })).ok).toBe(false);
    expect((await setOrgEntitlementOverride({ orgId: o.orgId, reason: REASON, features: { "agents.role.sdr": "sim" } })).ok).toBe(false);
    expect((await setOrgEntitlementOverride({ orgId: o.orgId, reason: REASON })).ok).toBe(false); // vazio
    const past = await setOrgEntitlementOverride({ ...base, reason: REASON, expiresAt: "2020-01-01" });
    expect(!past.ok && past.errors.expiresAt?.[0]).toMatch(/futura/);
    const junk = await setOrgEntitlementOverride({ ...base, reason: REASON, expiresAt: "amanha" });
    expect(!junk.ok && junk.errors.expiresAt?.[0]).toMatch(/inválida/);
    const ghost = await setOrgEntitlementOverride({ ...base, orgId: randomUUID(), reason: REASON });
    expect(!ghost.ok && ghost.errors._form?.[0]).toBe("Organização não encontrada.");
    expect((await setOrgEntitlementOverride({ ...base, orgId: "x", reason: REASON })).ok).toBe(false);
    expect(await prisma.orgEntitlementOverride.count({ where: { orgId: o.orgId } })).toBe(0);
    expect(await prisma.platformAuditLog.count({ where: { orgId: o.orgId } })).toBe(0);
  });

  it("cria, efetiva na hora (plano + override), atualiza (antes/depois) e remove, com auditoria completa", async () => {
    const o = await mk("ov-flow", "starter");
    await asAdmin();
    expect(hasFeature(await getEntitlements(prisma, o.orgId), "agents.role.closer")).toBe(false);
    const r = await setOrgEntitlementOverride({ orgId: o.orgId, reason: REASON, features: { "agents.role.closer": true, "agents.autonomy.auto": true }, limits: { maxActiveAgents: 3, maxAiBudgetCentsMonth: 15_000 }, expiresAt: "2099-12-31" });
    expect(r.ok).toBe(true);
    expect(r.ok && r.data.expiresAt).toBe("2099-12-31T23:59:59.999Z");
    let ent = await getEntitlements(prisma, o.orgId);
    expect(hasFeature(ent, "agents.role.closer")).toBe(true);
    expect(hasFeature(ent, "agents.role.sdr")).toBe(false); // so o que o override diz
    expect(limitOf(ent, "maxActiveAgents")).toBe(3);
    expect(ent.overrideActive).toBe(true);

    const upd = await setOrgEntitlementOverride({ orgId: o.orgId, reason: "Renovado ate fim do piloto", features: { "agents.role.closer": false }, limits: { maxActiveAgents: null } });
    expect(upd.ok).toBe(true);
    ent = await getEntitlements(prisma, o.orgId);
    expect(hasFeature(ent, "agents.role.closer")).toBe(false); // override pode RESTRINGIR
    expect(limitOf(ent, "maxActiveAgents")).toBeNull();
    expect((await prisma.orgEntitlementOverride.findUniqueOrThrow({ where: { orgId: o.orgId } })).createdBy).toBe(adminId);

    const logsRows = await prisma.platformAuditLog.findMany({ where: { orgId: o.orgId }, orderBy: { at: "asc" } });
    expect(logsRows.map((l) => l.action)).toEqual(["entitlement_override_set", "entitlement_override_set"]);
    expect(logsRows.every((l) => l.adminUserId === adminId && l.at instanceof Date)).toBe(true);
    expect(logsRows[0].reason).toBe(REASON);
    expect(logsRows[1].reason).toBe("Renovado ate fim do piloto");
    const m0 = logsRows[0].meta as { before: unknown; after: { limits: Record<string, number>; expiresAt: string } };
    expect(m0.before).toBeNull();
    expect(m0.after.limits.maxActiveAgents).toBe(3);
    const m1 = logsRows[1].meta as { before: { limits: Record<string, number> }; after: { limits: Record<string, unknown>; features: Record<string, boolean> } };
    expect(m1.before.limits.maxActiveAgents).toBe(3); // antes
    expect(m1.after.limits.maxActiveAgents).toBeNull(); // depois
    expect(m1.after.features["agents.role.closer"]).toBe(false);
    // efeito na org (OrgAuditLog): area + nomes dos campos, sem valores
    const orgLogs = await prisma.orgAuditLog.findMany({ where: { orgId: o.orgId, action: "admin_policy_changed" } });
    expect(orgLogs).toHaveLength(2);
    expect(orgLogs.every((l) => l.actorUserId === adminId)).toBe(true);
    expect(orgLogs[0].meta).toMatchObject({ area: "override" });

    const noOverride = await clearOrgEntitlementOverride({ orgId: o.orgId, reason: "Fim do piloto" });
    expect(noOverride.ok).toBe(true);
    expect(hasFeature(await getEntitlements(prisma, o.orgId), "agents.role.closer")).toBe(false);
    expect((await getEntitlements(prisma, o.orgId)).overrideActive).toBe(false);
    const again = await clearOrgEntitlementOverride({ orgId: o.orgId, reason: "Fim do piloto" });
    expect(!again.ok && again.errors._form?.[0]).toMatch(/não tem override/);
    const last = await prisma.platformAuditLog.findFirstOrThrow({ where: { orgId: o.orgId, action: "entitlement_override_clear" } });
    expect(last.reason).toBe("Fim do piloto");
    expect((last.meta as { after: unknown; before: { reason: string } }).after).toBeNull();
    expect((last.meta as { before: { reason: string } }).before.reason).toBe("Renovado ate fim do piloto");
    const noReasonClear = await clearOrgEntitlementOverride({ orgId: o.orgId });
    expect(noReasonClear.ok).toBe(false);
  });

  it("validade: relogio injetado — antes de expirar vale; depois NAO vale (e volta ao plano); validade passada em relacao ao relogio e recusada; sem prazo nunca expira", async () => {
    const o = await mk("ov-exp", "free");
    const now = new Date("2030-06-01T12:00:00Z");
    const tooLate = await setOverride(adminId, { orgId: o.orgId, reason: REASON, features: { "agents.role.followup": true }, expiresAt: "2030-05-31" }, now);
    expect(!tooLate.ok && tooLate.errors.expiresAt?.[0]).toMatch(/futura/);
    expect((await setOverride(adminId, { orgId: o.orgId, reason: REASON, features: { "agents.role.followup": true }, limits: { maxActiveAgents: 1 }, expiresAt: "2030-06-30" }, now)).ok).toBe(true);
    // o plano free nao tem agentes: so o override libera (a assinatura de teste e relativa a Date.now(); o relogio injetado e do futuro, entao usa o relogio real para o plano)
    expect(hasFeature(await getEntitlements(prisma, o.orgId, new Date()), "agents.role.followup")).toBe(true);
    const ov = await prisma.orgEntitlementOverride.findUniqueOrThrow({ where: { orgId: o.orgId } });
    expect(ov.expiresAt?.toISOString()).toBe("2030-06-30T23:59:59.999Z");
    const row = { status: "active" as const, subscription: null, entitlementOverride: { features: ov.features, limits: ov.limits, expiresAt: ov.expiresAt } };
    const { resolveEntitlements } = await import("@/lib/billing/entitlements");
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { orgId: o.orgId }, select: { status: true, pastDueSince: true, cancelAtPeriodEnd: true, currentPeriodEnd: true, plan: { select: { key: true, limits: true } } } });
    const subRow = { ...row, subscription: { ...sub, trialEndsAt: new Date("2031-01-01T00:00:00Z") } };
    expect(hasFeature(resolveEntitlements(o.orgId, subRow, new Date("2030-06-30T23:00:00Z")), "agents.role.followup")).toBe(true);
    const after = resolveEntitlements(o.orgId, subRow, new Date("2030-07-01T00:00:00Z"));
    expect(hasFeature(after, "agents.role.followup")).toBe(false); // expirou: volta ao plano
    expect(after.overrideActive).toBe(false);
    // sem prazo: nunca expira
    expect((await setOverride(adminId, { orgId: o.orgId, reason: REASON, features: { "agents.role.followup": true } }, now)).ok).toBe(true);
    const ov2 = await prisma.orgEntitlementOverride.findUniqueOrThrow({ where: { orgId: o.orgId } });
    expect(ov2.expiresAt).toBeNull();
    expect((await clearOverride(adminId, { orgId: o.orgId, reason: REASON })).ok).toBe(true);
  });

  it("override NAO destrava org bloqueada por pagamento (trial expirado) e past_due continua pausando IA", async () => {
    const free = await mk("ov-blocked", "free");
    await prisma.subscription.update({ where: { orgId: free.orgId }, data: { trialEndsAt: new Date(Date.now() - 86_400_000) } });
    await asAdmin();
    expect((await setOrgEntitlementOverride({ orgId: free.orgId, reason: REASON, features: { "agents.role.sdr": true, "inbox.reply": true } })).ok).toBe(true);
    const ent = await getEntitlements(prisma, free.orgId);
    expect(hasFeature(ent, "agents.role.sdr")).toBe(false);
    expect(hasFeature(ent, "inbox.reply")).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------------------------------------------
describe("kill switch, trava (lockedByAdmin) e teto da org", () => {
  it("admin liga/trava/define teto com auditoria; o tenant LIGA sempre, nao desliga travado, nao muda teto; admin destrava", async () => {
    const o = await mk("ks", "pro");
    await asAdmin();
    expect((await setOrgAgentSettingsByAdmin({ orgId: o.orgId, reason: REASON })).ok).toBe(false); // nada a alterar
    expect((await setOrgAgentSettingsByAdmin({ orgId: o.orgId, killSwitch: true })).ok).toBe(false); // motivo obrigatorio
    const r = await setOrgAgentSettingsByAdmin({ orgId: o.orgId, reason: "Cliente em auditoria interna", killSwitch: true, lockedByAdmin: true, monthlyBudgetCents: 20_000 });
    expect(r.ok && r.data).toEqual({ orgId: o.orgId, killSwitch: true, lockedByAdmin: true, monthlyBudgetCents: 20_000 });
    let a = await prisma.platformAuditLog.findFirstOrThrow({ where: { orgId: o.orgId, action: "agent_settings_set" } });
    expect((a.meta as { before: { killSwitch: boolean; lockedByAdmin: boolean }; after: { lockedByAdmin: boolean } }).before).toMatchObject({ killSwitch: true, lockedByAdmin: false });
    expect((a.meta as { after: { lockedByAdmin: boolean } }).after.lockedByAdmin).toBe(true);
    expect(a.adminUserId).toBe(adminId);

    await asOwner(o);
    const off = await updateAgentSettings({ killSwitch: false });
    expect(!off.ok && off.errors.code?.[0]).toBe("policy_admin_only");
    expect((await prisma.agentSettings.findUniqueOrThrow({ where: { orgId: o.orgId } })).killSwitch).toBe(true);
    expect((await updateAgentSettings({ killSwitch: true })).ok).toBe(true);

    await asAdmin();
    expect((await setOrgAgentSettingsByAdmin({ orgId: o.orgId, reason: "Auditoria concluida", lockedByAdmin: false, killSwitch: false })).ok).toBe(true);
    await asOwner(o);
    expect((await updateAgentSettings({ killSwitch: true })).ok).toBe(true); // tenant liga (emergencia)
    expect((await updateAgentSettings({ killSwitch: false })).ok).toBe(true); // destravado: desliga
    const rows = await prisma.platformAuditLog.count({ where: { orgId: o.orgId, action: "agent_settings_set" } });
    expect(rows).toBe(2);
    a = await prisma.platformAuditLog.findFirstOrThrow({ where: { orgId: o.orgId, action: "agent_settings_set" }, orderBy: { at: "desc" } });
    expect(a.reason).toBe("Auditoria concluida");
  });
  it("validacao do teto (>=1, <=100 milhoes) e org inexistente", async () => {
    const o = await mk("ks-val");
    await asAdmin();
    expect((await setOrgAgentSettingsByAdmin({ orgId: o.orgId, reason: REASON, monthlyBudgetCents: 0 })).ok).toBe(false);
    expect((await setOrgAgentSettingsByAdmin({ orgId: o.orgId, reason: REASON, monthlyBudgetCents: 10 ** 9 })).ok).toBe(false);
    expect((await setOrgAgentSettingsByAdmin({ orgId: randomUUID(), reason: REASON, killSwitch: true })).ok).toBe(false);
    const ok = await setOrgAgentSettingsByAdmin({ orgId: o.orgId, reason: REASON, monthlyBudgetCents: null });
    expect(ok.ok && ok.data.monthlyBudgetCents).toBeNull();
  });
});

// -------------------------------------------------------------------------------------------------------------------------------
describe("politica por agente: modelo, teto, mensagens/dia, turnos", () => {
  it("admin altera so campos de politica (conteudo do tenant intacto), com auditoria antes/depois; o agente tem que ser da org", async () => {
    const a = await mk("ap-a", "pro");
    const b = await mk("ap-b", "pro");
    const ag = await prisma.agent.create({ data: { orgId: a.orgId, role: "sdr", name: `zz069c-${uniq()}`, persona: "PERSONA SECRETA DO CLIENTE", monthlyBudgetCents: null, allowedTools: [] } });
    const agB = await prisma.agent.create({ data: { orgId: b.orgId, role: "sdr", name: `zz069c-${uniq()}`, persona: "outra", monthlyBudgetCents: 7000, allowedTools: [] } });
    await asAdmin();
    expect((await setAgentPolicyByAdmin({ orgId: a.orgId, agentId: ag.id, reason: REASON })).ok).toBe(false); // sem campo
    expect((await setAgentPolicyByAdmin({ orgId: a.orgId, agentId: ag.id, reason: REASON, model: "x y" })).ok).toBe(false); // modelo invalido
    expect((await setAgentPolicyByAdmin({ orgId: a.orgId, agentId: ag.id, reason: REASON, dailyMessageLimit: 0 })).ok).toBe(false);
    const r = await setAgentPolicyByAdmin({ orgId: a.orgId, agentId: ag.id, reason: REASON, model: "claude-sonnet-4-5", monthlyBudgetCents: 12_000, dailyMessageLimit: 50, maxTurnsPerLead: 8 });
    expect(r.ok && r.data).toEqual({ agentId: ag.id, model: "claude-sonnet-4-5", monthlyBudgetCents: 12_000, dailyMessageLimit: 50, maxTurnsPerLead: 8 });
    const cur = await prisma.agent.findUniqueOrThrow({ where: { id: ag.id } });
    expect(cur.persona).toBe("PERSONA SECRETA DO CLIENTE");
    expect(cur.updatedBy).toBe(adminId);
    const log = await prisma.platformAuditLog.findFirstOrThrow({ where: { orgId: a.orgId, action: "agent_policy_set" } });
    const m = log.meta as { before: { model: string; monthlyBudgetCents: number | null }; after: { model: string; monthlyBudgetCents: number } };
    expect(m.before).toMatchObject({ model: "claude-haiku-4-5", monthlyBudgetCents: null });
    expect(m.after).toMatchObject({ model: "claude-sonnet-4-5", monthlyBudgetCents: 12_000 });
    expect(dump(log)).not.toContain("PERSONA SECRETA"); // conteudo do tenant nunca na auditoria
    // remover o teto (null) e permitido: o agente deixa de rodar
    expect((await setAgentPolicyByAdmin({ orgId: a.orgId, agentId: ag.id, reason: REASON, monthlyBudgetCents: null })).ok).toBe(true);

    // ISOLAMENTO: agente da org B via org A = "nao encontrado", e B intacto
    const cross = await setAgentPolicyByAdmin({ orgId: a.orgId, agentId: agB.id, reason: REASON, model: "invasor", monthlyBudgetCents: 1 });
    expect(!cross.ok && cross.errors._form?.[0]).toBe("Agente não encontrado.");
    const bNow = await prisma.agent.findUniqueOrThrow({ where: { id: agB.id } });
    expect([bNow.model, bNow.monthlyBudgetCents]).toEqual(["claude-haiku-4-5", 7000]);
    expect(await prisma.platformAuditLog.count({ where: { orgId: b.orgId } })).toBe(0);
  });
});

// -------------------------------------------------------------------------------------------------------------------------------
describe("chave da plataforma por org: write-only, sem segredo em log/auditoria, tenant nao edita", () => {
  it("admin grava a chave (cifrada, managedByPlatform, so hint volta); vale em qualquer plano; auditoria sem valor; gira e remove", async () => {
    const o = await mk("key", "starter");
    await asAdmin();
    expect((await saveOrgIntegrationByAdmin({ orgId: o.orgId, integration: "places", value: SECRET })).ok).toBe(false); // motivo obrigatorio
    expect((await saveOrgIntegrationByAdmin({ orgId: o.orgId, reason: REASON, integration: "places" })).ok).toBe(false); // chave obrigatoria na criacao
    expect((await saveOrgIntegrationByAdmin({ orgId: o.orgId, reason: REASON, integration: "places", value: "curta" })).ok).toBe(false);
    expect((await saveOrgIntegrationByAdmin({ orgId: o.orgId, reason: REASON, integration: "evolution", value: SECRET, baseUrl: "http://169.254.169.254", allowPrivateHost: true })).ok).toBe(false); // SSRF
    const r = await saveOrgIntegrationByAdmin({ orgId: o.orgId, reason: REASON, integration: "places", value: SECRET });
    expect(r.ok).toBe(true);
    expect(dump(r)).not.toContain(SECRET);
    expect(r.ok && r.data.hint).toBe("wxyz");
    expect(r.ok && "baseUrl" in r.data).toBe(false); // M1: nunca a URL completa no retorno
    expect(r.ok && "managedByPlatform" in r.data).toBe(false);
    const row = await prisma.integrationSecret.findFirstOrThrow({ where: { orgId: o.orgId, integration: "places" } });
    expect(row.encryptedValue).toMatch(/^v1:/);
    expect(row.encryptedValue).not.toContain(SECRET);
    expect(row.managedByPlatform).toBe(true);
    expect(row.updatedById).toBe(adminId);
    expect((await findIntegrationConfig(o.orgId, "places"))?.reveal()).toBe(SECRET);

    // gira: a chave antiga some, auditoria "rotate"
    const SECOND = "sk-outra-chave-ZXCVBN-1234";
    expect((await saveOrgIntegrationByAdmin({ orgId: o.orgId, reason: "Rotacao trimestral", integration: "places", value: SECOND })).ok).toBe(true);
    expect((await findIntegrationConfig(o.orgId, "places"))?.reveal()).toBe(SECOND);
    expect((await prisma.integrationAuditLog.findMany({ where: { orgId: o.orgId } })).map((l) => l.action).sort()).toEqual(["create", "rotate"]);
    expect((await prisma.integrationAuditLog.findMany({ where: { orgId: o.orgId } })).every((l) => l.userId === adminId)).toBe(true);

    // remove
    const rm = await removeOrgIntegrationByAdmin({ orgId: o.orgId, reason: "Cliente saiu", id: row.id });
    expect(rm.ok).toBe(true);
    expect(await prisma.integrationSecret.count({ where: { orgId: o.orgId } })).toBe(0);

    // NENHUM segredo em auditoria nem em log
    const everything = dump([
      await prisma.platformAuditLog.findMany({ where: { orgId: o.orgId } }),
      await prisma.orgAuditLog.findMany({ where: { orgId: o.orgId } }),
      await prisma.integrationAuditLog.findMany({ where: { orgId: o.orgId } }),
      logs,
    ]);
    for (const s of [SECRET, SECOND, "QWERTY", "ZXCVBN", "wxyz"]) expect(everything, s).not.toContain(s);
    const actions = (await prisma.platformAuditLog.findMany({ where: { orgId: o.orgId }, orderBy: { at: "asc" } })).map((l) => l.action);
    expect(actions).toEqual(["integration_key_set", "integration_key_set", "integration_key_remove"]);
  });

  it("admin assume a chave legada do tenant (managedByPlatform passa a true); o tenant nao a edita nem remove depois", async () => {
    const o = await mk("key-take", "business");
    const legacy = await prisma.integrationSecret.create({ data: { orgId: o.orgId, integration: "llm", name: "default", encryptedValue: "v1:legacy", hint: "0000" } });
    await asAdmin();
    expect((await saveOrgIntegrationByAdmin({ orgId: o.orgId, reason: REASON, integration: "llm", value: SECRET })).ok).toBe(true);
    expect((await prisma.integrationSecret.findUniqueOrThrow({ where: { id: legacy.id } })).managedByPlatform).toBe(true);
    const { removeIntegration, saveIntegration } = await import("@/lib/actions/integration");
    await asOwner(o);
    expect((await removeIntegration({ id: legacy.id, confirm: true })).ok).toBe(false);
    expect((await saveIntegration({ integration: "llm", value: "chave-do-tenant-12345" })).ok).toBe(false);
    expect((await prisma.integrationSecret.findUniqueOrThrow({ where: { id: legacy.id } })).updatedById).toBe(adminId);
  });

  it("evolution com numeros de WhatsApp pendurados nao pode ser removida; id de outra org = nao encontrada (isolamento)", async () => {
    const a = await mk("key-evo-a");
    const b = await mk("key-evo-b");
    _setIntegrationResolver(async () => ["93.184.216.34"]);
    await asAdmin();
    const saved = await saveOrgIntegrationByAdmin({ orgId: a.orgId, reason: REASON, integration: "evolution", value: SECRET, baseUrl: "https://evo.exemplo.test/instancia/segredo" });
    expect(saved.ok).toBe(true);
    expect(dump(saved)).not.toContain("instancia/segredo"); // M1: so host mascarado
    expect(dump(saved)).not.toContain("evo.exemplo.test/");
    expect(saved.ok && saved.data.hostMasked).toBeTruthy();
    const id = saved.ok ? saved.data.id : "";
    await prisma.whatsAppInstance.create({ data: { orgId: a.orgId, instanceName: `zz069c-${uniq()}`, number: "+5511912340000", webhookToken: `zz069c-${uniq()}`, provider: "evolution" } as never });
    const blocked = await removeOrgIntegrationByAdmin({ orgId: a.orgId, reason: REASON, id });
    expect(!blocked.ok && blocked.errors._form?.[0]).toMatch(/instância/);
    const cross = await removeOrgIntegrationByAdmin({ orgId: b.orgId, reason: REASON, id });
    expect(!cross.ok && cross.errors._form?.[0]).toBe("Integração não encontrada.");
    expect(await prisma.integrationSecret.count({ where: { id } })).toBe(1);
  });
});

// -------------------------------------------------------------------------------------------------------------------------------
describe("isolamento A/B/C e admin sem acesso operacional", () => {
  it("override/kill switch/chave da org A nao mudam B nem C; a leitura de A nao traz conteudo de B", async () => {
    const A = await mk("iso-a", "starter");
    const B = await mk("iso-b", "starter");
    const C = await mk("iso-c", "starter");
    const secretPersona = `PERSONA-${uniq()}`;
    await prisma.agent.create({ data: { orgId: B.orgId, role: "followup", name: `zz069c-B-${uniq()}`, persona: secretPersona, monthlyBudgetCents: 100, allowedTools: [] } });
    const lead = await prisma.campaign.findFirst({ where: { orgId: A.orgId } });
    expect(lead).toBeNull();
    await asAdmin();
    await setOrgEntitlementOverride({ orgId: A.orgId, reason: REASON, features: { "agents.role.closer": true }, limits: { maxMembers: 99 } });
    await setOrgAgentSettingsByAdmin({ orgId: A.orgId, reason: REASON, killSwitch: false, lockedByAdmin: true });
    await saveOrgIntegrationByAdmin({ orgId: A.orgId, reason: REASON, integration: "places", value: SECRET });
    for (const o of [B, C]) {
      const ent = await getEntitlements(prisma, o.orgId);
      expect(hasFeature(ent, "agents.role.closer")).toBe(false);
      expect(limitOf(ent, "maxMembers")).toBe(3);
      expect(await prisma.agentSettings.count({ where: { orgId: o.orgId } })).toBe(0);
      expect(await prisma.integrationSecret.count({ where: { orgId: o.orgId } })).toBe(0);
      expect(await prisma.platformAuditLog.count({ where: { orgId: o.orgId } })).toBe(0);
      expect(await findIntegrationConfig(o.orgId, "places")).toBeNull();
    }
    const viewA = await getOrganizationPolicy(A.orgId);
    expect(viewA?.agents).toEqual([]);
    expect(dump(viewA)).not.toContain(secretPersona);
    const viewB = await getOrganizationPolicy(B.orgId);
    expect(viewB?.agents).toHaveLength(1);
    // so campos de politica: sem persona/objetivo/tom/conhecimento e sem valor de segredo
    expect(Object.keys(viewB!.agents[0]).sort()).toEqual(["active", "autonomy", "dailyMessageLimit", "id", "maxTurnsPerLead", "model", "monthlyBudgetCents", "role"]);
    expect(dump(viewB)).not.toContain(secretPersona);
    expect(dump(viewA)).not.toContain(SECRET);
    expect(dump(viewA)).not.toContain("encryptedValue");
    expect(viewA?.integrations[0]).toMatchObject({ integration: "places", managedByPlatform: true, hint: "wxyz" });
    expect(viewA?.agentSettings).toEqual({ killSwitch: false, lockedByAdmin: true, monthlyBudgetCents: null });
    expect(viewA?.audit.length).toBeGreaterThanOrEqual(3);
    expect(viewA?.catalog.features.length).toBeGreaterThan(5);
  });
});
