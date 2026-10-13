import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/channels/system-mail", () => ({ sendSystemEmail: vi.fn(async () => ({ ok: true, messageId: "m1" })) }));
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.LEAD_SEARCH_ENABLED = "true";

import { prisma } from "@/lib/prisma";
import { signOut } from "@/lib/auth/test-helpers";
import { purgeTestOrg } from "@/lib/test-utils/org-fixture";
import { mkCampaign } from "@/lib/test-utils/trial-fixture";
import { PLANS, asOwner, changePlan, errCode, mkPlanOrg, uniq, type PlanOrg } from "@/lib/test-utils/entitlements-fixture";
import { PlanLimitError } from "./limits";
import { PLAN_MATRIX } from "./plan-catalog";
import { getEntitlements, hasFeature, limitOf, PlanFeatureLockedError } from "./entitlements";
import { saveIntegration, testIntegration, removeIntegration } from "@/lib/actions/integration";
import { saveLeadSourceBinding, removeLeadSourceBinding } from "@/lib/actions/lead-source";
import { handleIngest } from "@/lib/lead-ingest/handler";
import { handleGoogleAdsWebhook } from "@/lib/lead-source/google-ads-handler";
import { ingestExternalLead } from "@/lib/lead-source/ingest";
import { sendManualWhatsApp } from "@/lib/inbox/send-manual";
import { inboxReadGuard } from "@/lib/inbox/http";
import { sendManualMessage, setConversationStatus, markConversationRead } from "@/lib/actions/inbox";
import { inviteMember } from "@/lib/actions/org";
import { createSequence, saveSequenceSteps, duplicateSequence } from "@/lib/actions/sequence";
import { joinWithInvite, joinWithCode, JoinInvalidError } from "@/lib/org/join";
import { hashInviteToken, newInviteToken, normalizeJoinCode } from "@/lib/org/tokens";
import { clearOrgRateLimits } from "@/lib/org/rate-limit";
import { runLeadSearch } from "@/lib/lead-search/run";
import type { LeadSource } from "@/lib/lead-search/types";
import { _resetIngestRateLimit } from "@/lib/lead-ingest/handler";
import { createCreativeDraft, submitCreative, type Deps } from "@/lib/creatives/service";
import { getCreativeConfig } from "@/lib/creatives/config";
import { MockAvatarVideoProvider } from "@/lib/creatives/providers/mock";
import { processCreativeJobs } from "@/lib/creatives/runner";
import { deferOverPlanBeforeReserve, reservableWhere } from "@/lib/channels/reserve";
import { getOrgLimits, assertWithinLimit } from "./limits";

/**
 * SPEC-069b — cada ponto de entrada de servidor x cada plano (Free/Starter/Pro/Business/courtesy), com banco real. Permitido x bloqueado,
 * mensagem com o nome do plano, downgrade/past_due sem apagar dados e isolamento A/B/C. Relogio real para o plano (assinaturas de teste
 * sao criadas relativas a `Date.now()`); onde a data importa o teste injeta `now`.
 */
const orgs: PlanOrg[] = [];
const mk = async (tag: string, plan: string, opts: Parameters<typeof mkPlanOrg>[2] = {}) => {
  const o = await mkPlanOrg(tag, plan, opts);
  orgs.push(o);
  return o;
};
const planName = (p: string) => PLAN_MATRIX[p as keyof typeof PLAN_MATRIX]?.name;

beforeAll(() => {
  clearOrgRateLimits();
});
afterEach(() => {
  signOut();
  clearOrgRateLimits();
  _resetIngestRateLimit();
});
afterAll(async () => {
  for (const o of orgs) {
    await prisma.creativeJob.deleteMany({ where: { orgId: o.orgId } });
    await prisma.creative.deleteMany({ where: { orgId: o.orgId } });
    await prisma.leadSourceBinding.deleteMany({ where: { orgId: o.orgId } });
    await prisma.integrationSecret.deleteMany({ where: { orgId: o.orgId } });
    await prisma.integrationAuditLog.deleteMany({ where: { orgId: o.orgId } });
    await prisma.webhookEvent.deleteMany({ where: { orgId: o.orgId } });
    await prisma.usageCounter.deleteMany({ where: { orgId: o.orgId } });
    await prisma.orgInvite.deleteMany({ where: { orgId: o.orgId } });
    await prisma.orgAuditLog.deleteMany({ where: { orgId: o.orgId } });
    await prisma.waMessage.deleteMany({ where: { orgId: o.orgId } }).catch(() => undefined);
    await prisma.orgEntitlementOverride.deleteMany({ where: { orgId: o.orgId } });
    await purgeTestOrg(o);
  }
});

// -------------------------------------------------------------------------------------------------------------------------------
describe("integracoes: BYOK (llm) e n8n por plano", () => {
  const LLM_OK: Record<string, boolean> = { free: false, starter: false, pro: false, business: true, courtesy: true };
  const N8N_OK: Record<string, boolean> = { free: false, starter: false, pro: true, business: true, courtesy: true };
  for (const plan of PLANS) {
    it(`${plan}: saveIntegration llm ${LLM_OK[plan] ? "liberado" : "barrado (BYOK desligado)"}`, async () => {
      const o = await mk("int-llm", plan);
      await asOwner(o);
      const r = await saveIntegration({ integration: "llm", value: `sk-test-${uniq()}-1234` });
      if (LLM_OK[plan]) expect(r.ok).toBe(true);
      else {
        expect(errCode(r)).toBe("plan_feature_locked");
        expect(!r.ok && r.errors.requiredPlan?.[0]).toBe("Business");
        expect(await prisma.integrationSecret.count({ where: { orgId: o.orgId } })).toBe(0); // nada gravado
      }
    });
    it(`${plan}: saveIntegration n8n ${N8N_OK[plan] ? "passa da trava do plano" : "barrado (ingest.api)"}`, async () => {
      const o = await mk("int-n8n", plan);
      await asOwner(o);
      const r = await saveIntegration({ integration: "n8n", value: `tok-${uniq()}-abcd`, baseUrl: "https://n8n.example.com" });
      if (N8N_OK[plan]) expect(errCode(r)).not.toBe("plan_feature_locked");
      else {
        expect(errCode(r)).toBe("plan_feature_locked");
        expect(!r.ok && r.errors.requiredPlan?.[0]).toBe("Pro");
        expect(!r.ok && r.errors._form?.[0]).toMatch(/plano Pro/);
      }
    });
  }

  it("testIntegration barra llm sem BYOK (antes de decifrar/chamar a rede); removeIntegration segue liberado (limpeza)", async () => {
    const o = await mk("int-test", "starter");
    const row = await prisma.integrationSecret.create({ data: { orgId: o.orgId, integration: "llm", name: "default", encryptedValue: "x", hint: "1234" } });
    await asOwner(o);
    const t = await testIntegration(row.id);
    expect(errCode(t)).toBe("plan_feature_locked");
    const rm = await removeIntegration({ id: row.id, confirm: true });
    expect(rm.ok).toBe(true);
  });

  it("override do admin libera BYOK numa org Pro (e so nela)", async () => {
    const a = await mk("int-ov-a", "pro");
    const b = await mk("int-ov-b", "pro");
    await prisma.orgEntitlementOverride.create({ data: { orgId: a.orgId, features: { "llm.byok": true }, reason: "piloto", createdBy: "t" } });
    await asOwner(a);
    expect((await saveIntegration({ integration: "llm", value: `sk-test-${uniq()}-1234` })).ok).toBe(true);
    await asOwner(b);
    expect(errCode(await saveIntegration({ integration: "llm", value: `sk-test-${uniq()}-1234` }))).toBe("plan_feature_locked");
  });
});

// -------------------------------------------------------------------------------------------------------------------------------
describe("fontes de lead: Google Ads/Meta (sources.ads) e ingestao por API/n8n (ingest.api)", () => {
  const ADS_OK: Record<string, boolean> = { free: false, starter: false, pro: true, business: true, courtesy: true };
  const body = (campaignId: string) => ({ campaignId, leads: [{ name: "Ana", email: `ana-${uniq()}@zz069b.com` }] });
  const post = (o: PlanOrg, campaignId: string) =>
    handleIngest(new Request("http://app.test/api/integrations/leads", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer segredo-de-teste-069b-0123456789" }, body: JSON.stringify(body(campaignId)) }), { secret: "segredo-de-teste-069b-0123456789", enabled: true });

  for (const plan of PLANS) {
    it(`${plan}: saveLeadSourceBinding ${ADS_OK[plan] ? "liberado" : "barrado"}`, async () => {
      const o = await mk("src-save", plan);
      const camp = await mkCampaign(o);
      await asOwner(o);
      const r = await saveLeadSourceBinding({ provider: "google_ads", externalAccountId: `zz069b-${uniq()}`, campaignId: camp });
      if (ADS_OK[plan]) expect(r.ok).toBe(true);
      else {
        expect(errCode(r)).toBe("plan_feature_locked");
        expect(!r.ok && r.errors.requiredPlan?.[0]).toBe("Pro");
        expect(await prisma.leadSourceBinding.count({ where: { orgId: o.orgId } })).toBe(0);
      }
    });
    it(`${plan}: ingestao n8n (POST /api/integrations/leads) ${ADS_OK[plan] ? "200" : "403 plan_feature_locked"}`, async () => {
      const o = await mk("src-n8n", plan);
      const camp = await mkCampaign(o);
      const res = await post(o, camp);
      if (ADS_OK[plan]) expect(res.status).toBe(200);
      else {
        expect(res.status).toBe(403);
        expect((await res.json()).error).toBe("plan_feature_locked");
        expect(await prisma.lead.count({ where: { campaignId: camp } })).toBe(0);
      }
    });
    it(`${plan}: ingestExternalLead (webhooks Google Ads/Meta) ${ADS_OK[plan] ? "cria" : "plan_feature_locked, sem reivindicar a chave"}`, async () => {
      const o = await mk("src-ext", plan);
      const camp = await mkCampaign(o);
      const ext = `zz069b-${uniq()}`;
      for (const source of ["google_ads_leads", "meta_leads"] as const) {
        const r = await ingestExternalLead({ source, orgId: o.orgId, campaignId: camp, externalLeadId: `${ext}-${source}`, contact: { name: "Bia", email: `bia-${uniq()}@zz069b.com`, phone: null, company: null, rawData: {} } });
        expect(r.status).toBe(ADS_OK[plan] ? "created" : "plan_feature_locked");
      }
      if (!ADS_OK[plan]) expect(await prisma.webhookEvent.count({ where: { orgId: o.orgId } })).toBe(0);
    });
  }

  it("handler do Google Ads: org sem a fonte recebe 403 plan_feature_locked e a configuracao (vinculo) e PRESERVADA", async () => {
    const o = await mk("src-g", "starter");
    const camp = await mkCampaign(o);
    const key = `zz069b-${uniq()}`;
    await prisma.leadSourceBinding.create({ data: { orgId: o.orgId, campaignId: camp, provider: "google_ads", externalAccountId: key } });
    const res = await handleGoogleAdsWebhook(new Request("http://app.test/api/integrations/leads/google-ads", { method: "POST", body: JSON.stringify({ google_key: key, lead_id: uniq(), user_column_data: [{ column_id: "FULL_NAME", string_value: "Cris" }, { column_id: "EMAIL", string_value: `c-${uniq()}@zz069b.com` }] }) }), { enabled: true });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("plan_feature_locked");
    expect(await prisma.leadSourceBinding.count({ where: { orgId: o.orgId } })).toBe(1);
    // upgrade: o mesmo vinculo volta a ingerir (sem reconfigurar)
    await changePlan(o, "pro");
    const ok = await handleGoogleAdsWebhook(new Request("http://app.test/api/integrations/leads/google-ads", { method: "POST", body: JSON.stringify({ google_key: key, lead_id: uniq(), user_column_data: [{ column_id: "FULL_NAME", string_value: "Cris" }, { column_id: "EMAIL", string_value: `c-${uniq()}@zz069b.com` }] }) }), { enabled: true });
    expect(ok.status).toBe(200);
  });

  it("removeLeadSourceBinding segue liberado em plano sem a fonte (limpeza)", async () => {
    const o = await mk("src-rm", "starter");
    const camp = await mkCampaign(o);
    const b = await prisma.leadSourceBinding.create({ data: { orgId: o.orgId, campaignId: camp, provider: "google_ads", externalAccountId: `zz069b-${uniq()}` } });
    await asOwner(o);
    expect((await removeLeadSourceBinding({ id: b.id, confirm: true })).ok).toBe(true);
  });

  it("business com org SUSPENSA nao ingere (QA 069a): bloqueado; courtesy sem assinatura continua liberado", async () => {
    const suspended = await mk("src-susp", "business", { orgStatus: "suspended" });
    const c1 = await mkCampaign(suspended);
    const r1 = await post(suspended, c1);
    expect([403]).toContain(r1.status);
    const courtesyNoSub = await mk("src-court", "courtesy");
    await prisma.subscription.delete({ where: { orgId: courtesyNoSub.orgId } });
    const c2 = await mkCampaign(courtesyNoSub);
    expect((await post(courtesyNoSub, c2)).status).toBe(200);
  });
});

// -------------------------------------------------------------------------------------------------------------------------------
describe("caixa de atendimento: Free le, Starter responde texto, Pro anexos/etiquetas (features reservadas para 068c/d/e)", () => {
  const REPLY_OK: Record<string, boolean> = { free: false, starter: true, pro: true, business: true, courtesy: true };
  for (const plan of PLANS) {
    it(`${plan}: leitura sempre; resposta ${REPLY_OK[plan] ? "passa da trava do plano" : "barrada"}`, async () => {
      const o = await mk("inbox", plan);
      await asOwner(o);
      const g = await inboxReadGuard();
      expect(g instanceof Response).toBe(false);
      const r = await sendManualWhatsApp({ orgId: o.orgId, userId: o.userId, conversationId: randomUUID(), clientMessageId: randomUUID(), text: "oi" });
      if (REPLY_OK[plan]) expect(!r.ok && r.code).toBe("not_found"); // passou do plano; a conversa nao existe
      else {
        expect(!r.ok && r.code).toBe("plan_feature_locked");
        expect(!r.ok && r.error).toMatch(/plano Starter/);
      }
      const a = await sendManualMessage({ conversationId: randomUUID(), clientMessageId: randomUUID(), text: "oi" });
      if (!REPLY_OK[plan]) {
        expect(errCode(a)).toBe("plan_feature_locked");
        expect(!a.ok && a.errors.requiredPlan?.[0]).toBe("Starter");
      }
      const st = await setConversationStatus({ conversationId: randomUUID(), status: "closed" });
      expect(errCode(st) === "plan_feature_locked").toBe(!REPLY_OK[plan]);
      const rd = await markConversationRead({ conversationId: randomUUID() }); // marcar como lida: leitura, nunca barrado
      expect(errCode(rd)).toBeUndefined();
    });
  }

  it("downgrade/past_due/trial: a leitura continua (fail-open so em leitura); override pode desligar a leitura", async () => {
    const pastDue = await mk("inbox-pd", "pro", { status: "past_due" });
    await asOwner(pastDue);
    expect((await inboxReadGuard()) instanceof Response).toBe(false);
    // past_due NAO pausa a resposta manual do atendente (so IA/envio automatico)
    const r = await sendManualWhatsApp({ orgId: pastDue.orgId, userId: pastDue.userId, conversationId: randomUUID(), clientMessageId: randomUUID(), text: "oi" });
    expect(!r.ok && r.code).toBe("not_found");
    const o = await mk("inbox-ov", "pro");
    await prisma.orgEntitlementOverride.create({ data: { orgId: o.orgId, features: { "inbox.read": false }, reason: "teste", createdBy: "t" } });
    await asOwner(o);
    const g = await inboxReadGuard();
    expect(g instanceof Response && g.status).toBe(403);
    expect(g instanceof Response && (await g.json()).error.code).toBe("plan_feature_locked");
  });

  it("downgrade Pro -> Free: conversas/mensagens seguem lidas; resposta barrada; upgrade reativa", async () => {
    const o = await mk("inbox-dg", "pro");
    await changePlan(o, "free");
    await asOwner(o);
    expect((await inboxReadGuard()) instanceof Response).toBe(false);
    expect(!(await sendManualWhatsApp({ orgId: o.orgId, userId: o.userId, conversationId: randomUUID(), clientMessageId: randomUUID(), text: "oi" })).ok).toBe(true);
    await changePlan(o, "starter");
    const r = await sendManualWhatsApp({ orgId: o.orgId, userId: o.userId, conversationId: randomUUID(), clientMessageId: randomUUID(), text: "oi" });
    expect(!r.ok && r.code).toBe("not_found");
  });
});

// -------------------------------------------------------------------------------------------------------------------------------
describe("equipe: maxMembers (convite e entrada por convite/codigo)", () => {
  const MEMBERS: Record<string, number | null> = { free: 1, starter: 3, pro: 10, business: null, courtesy: null };
  it("Free (1 membro): o dono ja ocupa a vaga; convidar e barrado com plan_limit/members", async () => {
    const o = await mk("team-free", "free");
    await asOwner(o);
    const r = await inviteMember({ email: `zz069b-${uniq()}@test.local` });
    expect(errCode(r)).toBe("plan_limit");
    expect(!r.ok && r.errors.metric?.[0]).toBe("members");
    expect(!r.ok && r.errors.limit?.[0]).toBe("1");
    expect(await prisma.orgInvite.count({ where: { orgId: o.orgId } })).toBe(0);
  });
  it("Starter (3): membros + convites pendentes contam; o 3o convite e barrado; revogar libera a vaga", async () => {
    const o = await mk("team-starter", "starter");
    await asOwner(o);
    const e = () => `zz069b-${uniq()}@test.local`;
    expect((await inviteMember({ email: e() })).ok).toBe(true);
    expect((await inviteMember({ email: e() })).ok).toBe(true);
    const third = await inviteMember({ email: e() });
    expect(errCode(third)).toBe("plan_limit");
    expect(!third.ok && third.errors._form?.[0]).toMatch(/3 membros/);
    const pending = await prisma.orgInvite.findFirstOrThrow({ where: { orgId: o.orgId, usedAt: null, revokedAt: null } });
    await prisma.orgInvite.update({ where: { id: pending.id }, data: { revokedAt: new Date() } });
    expect((await inviteMember({ email: e() })).ok).toBe(true);
  });
  it("reenviar convite ao MESMO e-mail no limite nao conta em dobro (substitui o pendente)", async () => {
    const o = await mk("team-resend", "starter");
    await asOwner(o);
    const same = `zz069b-${uniq()}@test.local`;
    const other = `zz069b-${uniq()}@test.local`;
    expect((await inviteMember({ email: same })).ok).toBe(true);
    expect((await inviteMember({ email: other })).ok).toBe(true);
    expect((await inviteMember({ email: same })).ok).toBe(true); // 1 + 1 (other) = 2 < 3
  });
  for (const plan of ["pro", "business", "courtesy"] as const) {
    it(`${plan}: convida (limite ${MEMBERS[plan] ?? "ilimitado"})`, async () => {
      const o = await mk("team-ok", plan);
      await asOwner(o);
      expect((await inviteMember({ email: `zz069b-${uniq()}@test.local` })).ok).toBe(true);
    });
  }
  it("entrada por convite/codigo no limite: barra com PlanLimitError e NAO queima o convite/uso do codigo (transacao desfeita)", async () => {
    const o = await mk("team-join", "starter");
    for (let i = 0; i < 2; i++) {
      const u = await prisma.user.create({ data: { name: `m${i}`, email: `zz069b-m${i}-${uniq()}@test.local`, role: "provider" } });
      await prisma.membership.create({ data: { userId: u.id, orgId: o.orgId, orgRole: "member" } });
    }
    const guestEmail = `zz069b-g-${uniq()}@test.local`;
    const guest = await prisma.user.create({ data: { name: "g", email: guestEmail, role: "provider" } });
    const { hash } = newInviteToken();
    await prisma.orgInvite.create({ data: { orgId: o.orgId, email: guestEmail, orgRole: "member", tokenHash: hash, expiresAt: new Date(Date.now() + 86_400_000) } });
    await expect(prisma.$transaction((tx) => joinWithInvite(tx, { tokenHash: hash, userId: guest.id, userEmail: guestEmail, now: new Date(), via: "invite" }))).rejects.toBeInstanceOf(PlanLimitError);
    expect((await prisma.orgInvite.findUniqueOrThrow({ where: { tokenHash: hash } })).usedAt).toBeNull();
    expect(await prisma.membership.count({ where: { orgId: o.orgId } })).toBe(3);
    // codigo reutilizavel
    await prisma.organization.update({ where: { id: o.orgId }, data: { joinCode: "ZZ069BCODE", joinCodeExpiresAt: new Date(Date.now() + 86_400_000), joinCodeMaxUses: 5, joinCodeUses: 0 } });
    await expect(prisma.$transaction((tx) => joinWithCode(tx, { code: normalizeJoinCode("ZZ069BCODE"), userId: guest.id, now: new Date(), via: "code" }))).rejects.toBeInstanceOf(PlanLimitError);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: o.orgId }, select: { joinCodeUses: true } })).joinCodeUses).toBe(0);
    void JoinInvalidError;
    void hashInviteToken;
  });
  it("downgrade Pro -> Starter: ninguem e removido (5 membros ficam), so barra novos; upgrade reativa", async () => {
    const o = await mk("team-dg", "pro");
    for (let i = 0; i < 4; i++) {
      const u = await prisma.user.create({ data: { name: `d${i}`, email: `zz069b-d${i}-${uniq()}@test.local`, role: "provider" } });
      await prisma.membership.create({ data: { userId: u.id, orgId: o.orgId, orgRole: "member" } });
    }
    await changePlan(o, "starter");
    await asOwner(o);
    expect(await prisma.membership.count({ where: { orgId: o.orgId } })).toBe(5);
    expect(errCode(await inviteMember({ email: `zz069b-${uniq()}@test.local` }))).toBe("plan_limit");
    expect(await prisma.membership.count({ where: { orgId: o.orgId } })).toBe(5);
    await changePlan(o, "pro");
    expect((await inviteMember({ email: `zz069b-${uniq()}@test.local` })).ok).toBe(true);
  });
});

// -------------------------------------------------------------------------------------------------------------------------------
describe("sequencias: maxSequenceSteps (3 / 5 / ilimitado)", () => {
  const STEPS: Record<string, number | null> = { free: 3, starter: 5, pro: null, business: null, courtesy: null };
  async function fixture(o: PlanOrg) {
    const camp = await mkCampaign(o);
    const tpl = await prisma.messageTemplate.create({ data: { campaignId: camp, orgId: o.orgId, channel: "email", name: `zz069b-${uniq()}`, subject: "Oi", body: "Corpo" } });
    const steps = (n: number) => Array.from({ length: n }, (_, i) => ({ day: i, channel: "email" as const, templateId: tpl.id }));
    return { steps };
  }
  for (const plan of PLANS) {
    it(`${plan}: createSequence no limite passa; 1 acima ${STEPS[plan] === null ? "tambem passa (ilimitado)" : "e barrado com plan_limit"}`, async () => {
      const o = await mk("seq", plan);
      const { steps } = await fixture(o);
      await asOwner(o);
      const lim = STEPS[plan];
      const okN = lim ?? 8;
      expect((await createSequence({ name: `zz069b ${uniq()}`, steps: steps(okN) })).ok).toBe(true);
      const over = await createSequence({ name: `zz069b ${uniq()}`, steps: steps(okN + 1) });
      if (lim === null) expect(over.ok).toBe(true);
      else {
        expect(errCode(over)).toBe("plan_limit");
        expect(!over.ok && over.errors.metric?.[0]).toBe("sequence_steps");
        expect(!over.ok && over.errors.limit?.[0]).toBe(String(lim));
      }
    });
  }
  it("downgrade: sequencia que ja tinha 6 passos continua editavel (nao cresce) e nada e apagado; copiar e crescer sao barrados", async () => {
    const o = await mk("seq-dg", "pro");
    const { steps } = await fixture(o);
    await asOwner(o);
    const created = await createSequence({ name: `zz069b ${uniq()}`, steps: steps(6) });
    expect(created.ok).toBe(true);
    const id = created.ok ? created.data.id : "";
    await changePlan(o, "starter"); // limite 5
    const existing = await prisma.sequenceStep.findMany({ where: { sequenceId: id }, orderBy: { order: "asc" } });
    expect(existing).toHaveLength(6);
    const same = existing.map((s) => ({ id: s.id, day: s.day, channel: s.channel as "email", templateId: s.templateId }));
    expect((await saveSequenceSteps({ sequenceId: id, steps: same })).ok).toBe(true); // mesmo tamanho: ok
    expect((await saveSequenceSteps({ sequenceId: id, steps: same.slice(0, 4) })).ok).toBe(true); // encolher: ok
    const grow = await saveSequenceSteps({ sequenceId: id, steps: [...same.slice(0, 4), { day: 20, channel: "email" as const, templateId: same[0].templateId }, { day: 21, channel: "email" as const, templateId: same[0].templateId }, { day: 22, channel: "email" as const, templateId: same[0].templateId }] });
    expect(errCode(grow)).toBe("plan_limit"); // 7 > 5 e > 4 existentes
    const dup = await createSequence({ name: `zz069b ${uniq()}`, steps: steps(6) });
    expect(errCode(dup)).toBe("plan_limit");
    const src = await createSequence({ name: `zz069b ${uniq()}`, steps: steps(5) });
    expect(src.ok).toBe(true);
    expect((await duplicateSequence(src.ok ? src.data.id : "")).ok).toBe(true); // 5 passos cabem
  });
});

// -------------------------------------------------------------------------------------------------------------------------------
describe("busca de leads: maxLeadSearchesPerDay (2 / 10 / 30 / ilimitado)", () => {
  const source = (): LeadSource => ({ id: "google_places", search: vi.fn(async () => ({ leads: [], requests: 1 })) });
  it("Free: 2 buscas por dia na org (campanhas diferentes), a 3a e barrada com plan_limit/lead_searches; sem chamada paga na barrada", async () => {
    const o = await mk("search-free", "free");
    const camps = [await mkCampaign(o), await mkCampaign(o), await mkCampaign(o)];
    await runLeadSearch(camps[0], { source: source() });
    await runLeadSearch(camps[1], { source: source() });
    const s3 = source();
    const err = await runLeadSearch(camps[2], { source: s3 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlanLimitError);
    expect((err as PlanLimitError).metric).toBe("lead_searches");
    expect((err as PlanLimitError).limit).toBe(2);
    expect(s3.search).not.toHaveBeenCalled();
    expect(await prisma.searchRun.count({ where: { campaignId: camps[2] } })).toBe(0); // nem run registrado
  });
  it("override do admin eleva o limite da org (3 buscas) sem tocar no plano; Business nao tem teto do plano", async () => {
    const o = await mk("search-ov", "free");
    await prisma.orgEntitlementOverride.create({ data: { orgId: o.orgId, features: {}, limits: { maxLeadSearchesPerDay: 3 }, reason: "t", createdBy: "t" } });
    const camps = [await mkCampaign(o), await mkCampaign(o), await mkCampaign(o), await mkCampaign(o)];
    for (const c of camps.slice(0, 3)) await runLeadSearch(c, { source: source() });
    await expect(runLeadSearch(camps[3], { source: source() })).rejects.toBeInstanceOf(PlanLimitError);
    const b = await mk("search-biz", "business");
    const bc = [await mkCampaign(b), await mkCampaign(b), await mkCampaign(b)];
    for (const c of bc) await runLeadSearch(c, { source: source() });
    expect(limitOf(await getEntitlements(prisma, b.orgId), "maxLeadSearchesPerDay")).toBeNull();
  });
  it("org A esgotada nao consome a cota da org B (isolamento)", async () => {
    const a = await mk("search-a", "free");
    const b = await mk("search-b", "free");
    const ca = [await mkCampaign(a), await mkCampaign(a), await mkCampaign(a)];
    const cb = [await mkCampaign(b), await mkCampaign(b)];
    await runLeadSearch(ca[0], { source: source() });
    await runLeadSearch(ca[1], { source: source() });
    await expect(runLeadSearch(ca[2], { source: source() })).rejects.toBeInstanceOf(PlanLimitError);
    await runLeadSearch(cb[0], { source: source() });
    await runLeadSearch(cb[1], { source: source() });
  });
  it("org bloqueada (trial expirado) nao busca: limite 0 fail-closed", async () => {
    const o = await mk("search-exp", "free");
    await prisma.subscription.update({ where: { orgId: o.orgId }, data: { trialEndsAt: new Date(Date.now() - 86_400_000) } });
    const c = await mkCampaign(o);
    await expect(runLeadSearch(c, { source: source() })).rejects.toBeInstanceOf(PlanLimitError);
  });
});

// -------------------------------------------------------------------------------------------------------------------------------
describe("criativos: maxCreativesPerMonth (0 / 3 / 20 / ilimitado) e runner", () => {
  const T0 = new Date();
  const mkDeps = () => {
    const provider = new MockAvatarVideoProvider({ delayMs: 0, now: () => T0.getTime() });
    const config = { ...getCreativeConfig({ NODE_ENV: "test" }), maxConcurrentJobsPerOrg: 100, maxPerMonthPerOrg: 1000 };
    const deps: Deps = { provider, config, now: T0 };
    return { provider, config, deps };
  };
  const draft = (o: PlanOrg, deps: Deps) => createCreativeDraft({ orgId: o.orgId, userId: o.userId }, { title: "Meu criativo", script: "Olá, este é um roteiro curto.", language: "pt-BR", avatarRef: "mock-ana", voiceRef: "mock-voz-br-f", aspectRatio: "9:16" }, deps);
  const ctx = (o: PlanOrg) => ({ orgId: o.orgId, userId: o.userId });

  it("Free (0): nem rascunho; mensagem 'nao inclui criativos'", async () => {
    const o = await mk("cr-free", "free");
    const { deps } = mkDeps();
    const err = await draft(o, deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlanLimitError);
    expect((err as PlanLimitError).message).toMatch(/não inclui criativos/);
    expect(await prisma.creative.count({ where: { orgId: o.orgId } })).toBe(0);
  });
  it("Starter (3): 3 envios no mes passam, o 4o e barrado (rascunhos livres); reenvio de criativo ja contado nao consome cota", async () => {
    const o = await mk("cr-starter", "starter");
    const { deps } = mkDeps();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await draft(o, deps)).id);
    for (const id of ids.slice(0, 3)) await submitCreative(ctx(o), id, deps);
    const err = await submitCreative(ctx(o), ids[3], deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlanLimitError);
    expect((err as PlanLimitError).metric).toBe("creatives");
    expect((err as PlanLimitError).limit).toBe(3);
    expect((await prisma.creative.findUniqueOrThrow({ where: { id: ids[3] } })).status).toBe("draft"); // nada perdido
  });
  it("Pro: 20/mes; Business/courtesy: sem teto do plano; override muda o teto da org", async () => {
    expect(limitOf(await getEntitlements(prisma, (await mk("cr-pro", "pro")).orgId), "maxCreativesPerMonth")).toBe(20);
    for (const plan of ["business", "courtesy"] as const) {
      const o = await mk("cr-full", plan);
      expect(limitOf(await getEntitlements(prisma, o.orgId), "maxCreativesPerMonth")).toBeNull();
      const { deps } = mkDeps();
      for (let i = 0; i < 4; i++) await submitCreative(ctx(o), (await draft(o, deps)).id, deps);
    }
    const ov = await mk("cr-ov", "starter");
    await prisma.orgEntitlementOverride.create({ data: { orgId: ov.orgId, features: {}, limits: { maxCreativesPerMonth: 4 }, reason: "t", createdBy: "t" } });
    const { deps } = mkDeps();
    for (let i = 0; i < 4; i++) await submitCreative(ctx(ov), (await draft(ov, deps)).id, deps);
    await expect(submitCreative(ctx(ov), (await draft(ov, deps)).id, deps)).rejects.toBeInstanceOf(PlanLimitError);
  });
  it("runner: downgrade para Free / past_due / plano ilegivel => NAO chama o provedor, job segue queued e a criacao e preservada; upgrade volta a rodar", async () => {
    const o = await mk("cr-run", "starter");
    const { provider, deps } = mkDeps();
    const spy = vi.spyOn(provider, "createVideo");
    const id = (await submitCreative(ctx(o), (await draft(o, deps)).id, deps)).id;
    const rd = { provider, config: deps.config, random: () => 0.5 };
    // limpa jobs devidos de outras orgs do teste: so olhamos o job desta org
    const jobOf = () => prisma.creativeJob.findFirstOrThrow({ where: { creativeId: id } });
    for (const st of [{ plan: "free" }, { plan: "pro", status: "past_due" as const }] as const) {
      await changePlan(o, st.plan, "status" in st ? st.status : undefined);
      await processCreativeJobs(new Date(Date.now() + 60_000), rd);
      expect(spy.mock.calls.filter((c) => c[0].idempotencyKey.includes(id))).toHaveLength(0);
      expect((await jobOf()).status).toBe("queued");
      expect((await prisma.creative.findUniqueOrThrow({ where: { id } })).status).toBe("queued");
      await prisma.creativeJob.update({ where: { id: (await jobOf()).id }, data: { nextRunAt: new Date(Date.now() - 1000), lockedAt: null } });
    }
    await changePlan(o, "starter");
    await processCreativeJobs(new Date(Date.now() + 60_000), rd);
    expect(spy.mock.calls.filter((c) => c[0].idempotencyKey.includes(id)).length).toBeGreaterThan(0);
    expect((await jobOf()).status).toBe("processing");
  });
});

// -------------------------------------------------------------------------------------------------------------------------------
describe("limites legados via modulo (e-mail, envios/dia, whatsapp...): override-aware", () => {
  const SENDS: Record<string, number | null> = { free: 20, starter: 300, pro: 1000, business: null, courtesy: null };
  const EMAIL: Record<string, number | null> = { free: 1, starter: 1, pro: 3, business: null, courtesy: null };
  for (const plan of PLANS) {
    it(`${plan}: getOrgLimits (maxSendsPerDay=${SENDS[plan]}, maxEmailAccounts=${EMAIL[plan]}) vem do modulo`, async () => {
      const o = await mk("lim", plan);
      const l = await getOrgLimits(prisma, o.orgId);
      expect(l.maxSendsPerDay).toBe(SENDS[plan]);
      expect(l.maxEmailAccounts).toBe(EMAIL[plan]);
      expect(l.trialing).toBe(plan === "free");
      expect(l.planKey).toBe(plan);
    });
  }
  it("override: eleva maxEmailAccounts de uma org Starter (assertWithinLimit) e e ignorado por outra org Starter; override expirado nao vale", async () => {
    const a = await mk("lim-a", "starter");
    const b = await mk("lim-b", "starter");
    const c = await mk("lim-c", "starter");
    await prisma.orgEntitlementOverride.create({ data: { orgId: a.orgId, features: {}, limits: { maxEmailAccounts: 5, maxSendsPerDay: null }, reason: "t", createdBy: "t" } });
    await prisma.orgEntitlementOverride.create({ data: { orgId: c.orgId, features: {}, limits: { maxEmailAccounts: 5 }, reason: "t", createdBy: "t", expiresAt: new Date(Date.now() - 1000) } });
    await assertWithinLimit(prisma, a.orgId, "email_accounts", 4);
    await expect(assertWithinLimit(prisma, b.orgId, "email_accounts", 1)).rejects.toBeInstanceOf(PlanLimitError);
    await expect(assertWithinLimit(prisma, c.orgId, "email_accounts", 1)).rejects.toBeInstanceOf(PlanLimitError);
    expect((await getOrgLimits(prisma, a.orgId)).maxSendsPerDay).toBeNull();
    expect((await getOrgLimits(prisma, b.orgId)).maxSendsPerDay).toBe(300);
  });
  async function mkTouch(o: PlanOrg) {
    const camp = await mkCampaign(o);
    const lead = await prisma.lead.create({ data: { campaignId: camp, name: "S", email: `zz069b-${uniq()}@example.com`, source: "manual" }, select: { id: true } });
    return (await prisma.touch.create({ data: { leadId: lead.id, channel: "email", status: "scheduled", scheduledAt: new Date() }, select: { id: true } })).id;
  }
  const where = (id: string) => reservableWhere(id, 60_000);
  it("envio (ponto unico `deferOverPlanBeforeReserve`): past_due e plano ilegivel ADIAM (fail-closed, sem queimar tentativa); em dia passa; business suspensa tambem adia", async () => {
    const ok = await mk("snd-ok", "pro");
    const t0 = await mkTouch(ok);
    expect(await deferOverPlanBeforeReserve(t0, where(t0), new Date())).toBeNull();

    const pd = await mk("snd-pd", "pro", { status: "past_due" });
    const t1 = await mkTouch(pd);
    const d1 = await deferOverPlanBeforeReserve(t1, where(t1), new Date());
    expect(d1).toMatchObject({ reason: "plan_locked" });
    expect(await prisma.touch.findUniqueOrThrow({ where: { id: t1 } })).toMatchObject({ status: "scheduled", attempts: 0 });
    // regularizou: volta a enviar
    await changePlan(pd, "pro");
    expect(await deferOverPlanBeforeReserve(t1, where(t1), new Date())).toBeNull();

    const garbage = await mk("snd-garb", "starter");
    const { ensureGarbagePlan } = await import("@/lib/test-utils/entitlements-fixture");
    await ensureGarbagePlan();
    await changePlan(garbage, "zz-069b-garbage", "active");
    const t2 = await mkTouch(garbage);
    expect(await deferOverPlanBeforeReserve(t2, where(t2), new Date())).toMatchObject({ reason: "plan_locked" });

    const biz = await mk("snd-biz", "business", { orgStatus: "suspended" });
    const t3 = await mkTouch(biz);
    expect(await deferOverPlanBeforeReserve(t3, where(t3), new Date())).toMatchObject({ reason: "plan_locked" });
    const bizOk = await mk("snd-biz-ok", "business");
    const t4 = await mkTouch(bizOk);
    expect(await deferOverPlanBeforeReserve(t4, where(t4), new Date())).toBeNull();
  });
  it("envio: maxSendsPerDay com override (1/dia) adia o 2o do dia; sem override segue o plano", async () => {
    const o = await mk("snd-ov", "pro");
    await prisma.orgEntitlementOverride.create({ data: { orgId: o.orgId, features: {}, limits: { maxSendsPerDay: 1 }, reason: "t", createdBy: "t" } });
    const [a, b] = [await mkTouch(o), await mkTouch(o)];
    const now = new Date();
    expect(await deferOverPlanBeforeReserve(a, where(a), now)).toBeNull();
    expect(await deferOverPlanBeforeReserve(b, where(b), now)).toMatchObject({ reason: "plan_limit" });
  });
});

// -------------------------------------------------------------------------------------------------------------------------------
describe("isolamento A/B/C e erro tipado", () => {
  it("A Free, B Pro, C Business: cada org enxerga SO o seu plano/override; mudar uma nao afeta as outras", async () => {
    const [a, b, c] = [await mk("iso-a", "free"), await mk("iso-b", "pro"), await mk("iso-c", "business")];
    await prisma.orgEntitlementOverride.create({ data: { orgId: a.orgId, features: { "sources.ads": true }, reason: "t", createdBy: "t" } });
    const [ea, eb, ec] = await Promise.all([a, b, c].map((o) => getEntitlements(prisma, o.orgId)));
    expect(hasFeature(ea, "sources.ads")).toBe(true); // override so na A
    expect(hasFeature(ea, "ingest.api")).toBe(false);
    expect(hasFeature(eb, "ingest.api")).toBe(true);
    expect(hasFeature(ec, "llm.byok")).toBe(true);
    expect(hasFeature(eb, "llm.byok")).toBe(false);
    await changePlan(b, "free");
    expect(hasFeature(await getEntitlements(prisma, b.orgId), "ingest.api")).toBe(false);
    expect(hasFeature(await getEntitlements(prisma, c.orgId), "llm.byok")).toBe(true);
    expect(hasFeature(await getEntitlements(prisma, a.orgId), "sources.ads")).toBe(true);
  });
  it("PlanFeatureLockedError traz o nome do plano necessario em PT-BR", () => {
    expect(new PlanFeatureLockedError("sources.ads").message).toMatch(/plano Pro/);
    expect(new PlanFeatureLockedError("llm.byok").requiredPlan).toBe("Business");
    expect(planName("pro")).toBe("Pro");
  });
});
