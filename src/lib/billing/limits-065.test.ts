import "dotenv/config";
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
const fake = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/whatsapp/provider", async (orig) => ({ ...(await orig<typeof import("@/lib/whatsapp/provider")>()), getWhatsAppProvider: () => fake.current }));
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.APP_BASE_URL = "http://app.test";

import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { DAY, ensureTestPlan, mkCampaign, mkIcp, setOrgPlan, setTrial } from "@/lib/test-utils/trial-fixture";
import { signInAs, signOut } from "@/lib/auth/test-helpers";
import { FakeWhatsAppProvider } from "@/lib/whatsapp/providers/fake";
import { archiveCampaign, createCampaign, duplicateCampaign, pauseCampaign, resumeCampaign, updateCampaign } from "@/lib/actions/campaign";
import { createWhatsAppInstance } from "@/lib/actions/whatsapp";
import { createEmailAccount } from "@/lib/actions/email";
import { createLead } from "@/lib/actions/lead";
import { handleIngest } from "@/lib/lead-ingest/handler";
import { ingestExternalLead } from "@/lib/lead-source/ingest";
import { deferOverPlanBeforeReserve, reservableWhere, PLAN_SEND_LIMIT_MESSAGE } from "@/lib/channels/reserve";
import { sendEmail } from "@/lib/channels/email";
import { sendWhatsApp } from "@/lib/channels/whatsapp";
import { getOrgLimits } from "./limits";
import { dayKey, leadsPeriodKey, monthKey, nextBrtDayStart, reserveUsage } from "./usage";

const orgs: TestOrg[] = [];
const mk = async (tag: string) => {
  const o = await createTestOrg(tag);
  orgs.push(o);
  return o;
};
const asOwner = (o: TestOrg) => signInAs(o.userId, { orgId: o.orgId, platformRole: "provider" });
const errCode = (r: { ok: boolean; errors?: Record<string, string[]> }) => (!r.ok ? r.errors?.code?.[0] : undefined);

beforeAll(async () => {
  await ensureTestPlan("zz-lim1", { maxCampaigns: 1, maxWhatsappInstances: 1, maxEmailAccounts: 1, maxLeadsPerMonth: 3, maxSendsPerDay: 2 });
  await ensureTestPlan("zz-big", { maxCampaigns: 5, maxWhatsappInstances: 5, maxEmailAccounts: 5, maxLeadsPerMonth: 100, maxSendsPerDay: 100 });
  await ensureTestPlan("zz-unl", { maxCampaigns: null, maxWhatsappInstances: null, maxLeadsPerMonth: null });
});
afterEach(() => {
  signOut();
  vi.useRealTimers();
});
afterAll(async () => {
  for (const o of orgs) {
    await prisma.usageCounter.deleteMany({ where: { orgId: o.orgId } });
    await prisma.whatsAppInstance.deleteMany({ where: { orgId: o.orgId } });
    await purgeTestOrg(o);
  }
});

const campInput = (icpId: string, name: string, status: "active" | "paused" | "archived" = "active") => ({ name, icpId, status });

describe("chaves de periodo (BRT) e reserveUsage atomico", () => {
  it("dayKey/monthKey usam America/Sao_Paulo; leads: `trial` fixa no trial, mes civil no pago", () => {
    // 2026-12-01T02:00Z = 30/11 23:00 BRT
    expect(dayKey(new Date("2026-12-01T02:00:00Z"))).toBe("2026-11-30");
    expect(monthKey(new Date("2026-12-01T02:00:00Z"))).toBe("2026-11");
    expect(dayKey(new Date("2026-12-01T03:00:00Z"))).toBe("2026-12-01");
    expect(monthKey(new Date("2026-12-01T03:00:00Z"))).toBe("2026-12");
    expect(leadsPeriodKey({ trialing: true }, new Date("2026-12-01T12:00:00Z"))).toBe("trial");
    expect(leadsPeriodKey({ trialing: false }, new Date("2026-12-01T12:00:00Z"))).toBe("2026-12");
  });
  it("nextBrtDayStart: meia-noite BRT seguinte (+1 min)", () => {
    expect(nextBrtDayStart(new Date("2026-11-30T15:00:00Z")).toISOString()).toBe("2026-12-01T03:01:00.000Z");
  });
  it("reserveUsage: sob Promise.all com limite 3 reserva exatamente 3; devolve used; n > limite falha; null = ilimitado", async () => {
    const o = await mk("usage");
    const rs = await Promise.all(Array.from({ length: 10 }, () => reserveUsage(prisma, o.orgId, "leads", "trial", 1, 3)));
    expect(rs.filter((r) => r.ok)).toHaveLength(3);
    expect((await prisma.usageCounter.findUniqueOrThrow({ where: { orgId_metric_periodKey: { orgId: o.orgId, metric: "leads", periodKey: "trial" } } })).count).toBe(3);
    expect(rs.find((r) => !r.ok)).toMatchObject({ ok: false, used: 3 });
    expect(await reserveUsage(prisma, o.orgId, "sends", "2026-01-01", 5, 3)).toMatchObject({ ok: false });
    expect(await reserveUsage(prisma, o.orgId, "sends", "2026-01-01", 5, null)).toMatchObject({ ok: true });
    expect(await prisma.usageCounter.count({ where: { orgId: o.orgId, metric: "sends" } })).toBe(0); // ilimitado nao grava nada
  });
  it("rollback da transacao devolve a reserva; contadores sao por orgId e por periodo", async () => {
    const a = await mk("usage-a");
    const b = await mk("usage-b");
    await expect(
      prisma.$transaction(async (tx) => {
        expect((await reserveUsage(tx, a.orgId, "leads", "trial", 1, 1)).ok).toBe(true);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect((await reserveUsage(prisma, a.orgId, "leads", "trial", 1, 1)).ok).toBe(true); // cota devolvida pelo rollback
    expect((await reserveUsage(prisma, a.orgId, "leads", "trial", 1, 1)).ok).toBe(false);
    expect((await reserveUsage(prisma, b.orgId, "leads", "trial", 1, 1)).ok).toBe(true); // org A nao consome cota da B
    expect((await reserveUsage(prisma, a.orgId, "leads", "2099-01", 1, 1)).ok).toBe(true); // outro periodo
  });
});

describe("getOrgLimits", () => {
  it("le o plano da Subscription; sem Subscription e courtesy = ilimitado; trialing marcado", async () => {
    const o = await mk("getlimits");
    expect(await getOrgLimits(prisma, o.orgId)).toMatchObject({ maxCampaigns: null, maxLeadsPerMonth: null, planKey: null, trialing: false });
    await setTrial(o.orgId, "zz-lim1");
    expect(await getOrgLimits(prisma, o.orgId)).toMatchObject({ maxCampaigns: 1, maxWhatsappInstances: 1, maxEmailAccounts: 1, maxLeadsPerMonth: 3, maxSendsPerDay: 2, trialing: true });
    await setOrgPlan(o.orgId, { planKey: "courtesy", status: "active", trialEndsAt: null });
    expect(await getOrgLimits(prisma, o.orgId)).toMatchObject({ maxCampaigns: null, planKey: "courtesy" });
    await setOrgPlan(o.orgId, { planKey: "free", status: "trialing" });
    expect(await getOrgLimits(prisma, o.orgId)).toMatchObject({ planKey: "free", maxCampaigns: 1, maxEmailAccounts: 1, maxSendsPerDay: 20 });
  });
});

describe("maxCampaigns (campanhas ativas)", () => {
  it("createCampaign: 1a ok, 2a barrada com plan_limit {metric,limit,used}; pausada/arquivada nunca barra; org sem plano ilimitada", async () => {
    const o = await mk("camp");
    await setTrial(o.orgId, "zz-lim1");
    await asOwner(o);
    const icp = await mkIcp(o);
    expect((await createCampaign(campInput(icp, "c1"))).ok).toBe(true);
    const r = await createCampaign(campInput(icp, "c2"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.code).toEqual(["plan_limit"]);
      expect(r.errors.metric).toEqual(["campaigns"]);
      expect(r.errors.limit).toEqual(["1"]);
      expect(r.errors.used).toEqual(["1"]);
      expect(r.errors._form[0]).toMatch(/1 campanha ativa/);
    }
    expect((await createCampaign(campInput(icp, "c3", "paused"))).ok).toBe(true);
    expect((await createCampaign(campInput(icp, "c4", "archived"))).ok).toBe(true);
    expect(await prisma.campaign.count({ where: { orgId: o.orgId, status: "active" } })).toBe(1);
    await prisma.subscription.deleteMany({ where: { orgId: o.orgId } });
    expect((await createCampaign(campInput(icp, "c5"))).ok).toBe(true); // sem Subscription: ilimitada
  });
  it("concorrencia: 6 createCampaign em paralelo com cota 1 => exatamente 1 cria", async () => {
    const o = await mk("camp-race");
    await setTrial(o.orgId, "zz-lim1");
    await asOwner(o);
    const icp = await mkIcp(o);
    const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => createCampaign(campInput(icp, `race${i}`))));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.filter((r) => !r.ok && errCode(r) === "plan_limit")).toHaveLength(5);
    expect(await prisma.campaign.count({ where: { orgId: o.orgId, status: "active" } })).toBe(1);
  });
  it("retomar, desarquivar (update) e duplicar+retomar NAO burlam o limite; pausar/arquivar nunca e barrado; trocar de uma campanha ja ativa nao conta contra si", async () => {
    const o = await mk("camp-resume");
    await setTrial(o.orgId, "zz-lim1");
    await asOwner(o);
    const active = await mkCampaign(o, "active");
    const paused = await mkCampaign(o, "paused");
    const archived = await mkCampaign(o, "archived");
    expect(errCode(await resumeCampaign(paused))).toBe("plan_limit");
    expect(errCode(await updateCampaign({ id: archived, name: "x", icpId: (await prisma.campaign.findUniqueOrThrow({ where: { id: archived } })).icpId, status: "active" }))).toBe("plan_limit");
    const dup = await duplicateCampaign(active);
    expect(dup.ok).toBe(true); // a copia nasce pausada
    if (dup.ok) {
      expect((await prisma.campaign.findUniqueOrThrow({ where: { id: dup.data.id } })).status).toBe("paused");
      expect(errCode(await resumeCampaign(dup.data.id))).toBe("plan_limit");
    }
    // editar a campanha JA ativa (status active) nao e barrado
    expect((await updateCampaign({ id: active, name: "renomeada", icpId: (await prisma.campaign.findUniqueOrThrow({ where: { id: active } })).icpId, status: "active" })).ok).toBe(true);
    expect((await resumeCampaign(active)).ok).toBe(true); // ja ativa: idempotente
    expect((await pauseCampaign(active)).ok).toBe(true);
    expect((await resumeCampaign(paused)).ok).toBe(true); // agora ha vaga
    expect(errCode(await resumeCampaign(active))).toBe("plan_limit");
    expect((await archiveCampaign(paused)).ok).toBe(true);
    expect((await resumeCampaign(active)).ok).toBe(true);
  });
  it("concorrencia: 3 resumeCampaign simultaneos de campanhas pausadas com cota 1 => exatamente 1 ativa", async () => {
    const o = await mk("camp-resume-race");
    await setTrial(o.orgId, "zz-lim1");
    await asOwner(o);
    const ids = [await mkCampaign(o, "paused"), await mkCampaign(o, "paused"), await mkCampaign(o, "paused")];
    const rs = await Promise.all(ids.map((id) => resumeCampaign(id)));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(await prisma.campaign.count({ where: { orgId: o.orgId, status: "active" } })).toBe(1);
  });
  it("downgrade nao retroage (nada e pausado; so barra novas ativacoes); upgrade libera na hora (mesma sessao)", async () => {
    const o = await mk("camp-downgrade");
    await setOrgPlan(o.orgId, { planKey: "zz-big", status: "active", trialEndsAt: null });
    await asOwner(o);
    const icp = await mkIcp(o);
    for (let i = 0; i < 3; i++) expect((await createCampaign(campInput(icp, `d${i}`))).ok).toBe(true);
    await setOrgPlan(o.orgId, { planKey: "zz-lim1", status: "active", trialEndsAt: null });
    expect(await prisma.campaign.count({ where: { orgId: o.orgId, status: "active" } })).toBe(3); // nada pausado
    expect(errCode(await createCampaign(campInput(icp, "novo")))).toBe("plan_limit");
    await setOrgPlan(o.orgId, { planKey: "zz-big", status: "active", trialEndsAt: null });
    expect((await createCampaign(campInput(icp, "novo2"))).ok).toBe(true);
  });
  it("org com trial EXPIRADO e barrada mesmo abaixo da cota (bloqueio total vence)", async () => {
    const o = await mk("camp-expired");
    await setTrial(o.orgId, "zz-big", true);
    await asOwner(o);
    const icp = await mkIcp(o);
    const r = await createCampaign(campInput(icp, "x"));
    expect(r.ok).toBe(false);
    expect(errCode(r)).toBe("trial_expired");
  });
});

describe("maxWhatsappInstances", () => {
  it("antes de chamar o provedor; 1a ok, 2a barrada SEM chamar o provedor; concorrencia (4 em paralelo) => exatamente 1 e os perdedores sao removidos do provedor", async () => {
    const o = await mk("wa");
    await setTrial(o.orgId, "zz-lim1");
    await asOwner(o);
    const f = new FakeWhatsAppProvider();
    fake.current = f;
    const tag = `zz065wa${Math.random().toString(36).slice(2, 6)}`;
    expect((await createWhatsAppInstance({ instanceName: `${tag}-1`, number: "(11) 91234-5678" })).ok).toBe(true);
    const created = f.created.length;
    const r2 = await createWhatsAppInstance({ instanceName: `${tag}-2`, number: "(11) 91234-5679" });
    expect(errCode(r2)).toBe("plan_limit");
    expect(f.created.length).toBe(created); // checagem previa: provedor nao foi chamado

    const o2 = await mk("wa-race");
    await setTrial(o2.orgId, "zz-lim1");
    await asOwner(o2);
    const f2 = new FakeWhatsAppProvider();
    fake.current = f2;
    const rs = await Promise.all([1, 2, 3, 4].map((i) => createWhatsAppInstance({ instanceName: `${tag}-r${i}`, number: `(11) 9${i}234-5670` })));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(await prisma.whatsAppInstance.count({ where: { orgId: o2.orgId } })).toBe(1);
    // quem perdeu a corrida depois de criar no provedor foi limpo la (compensacao)
    expect(f2.created.length - f2.deleted.length).toBe(1);
  });
  it("anti-abuso: o mesmo numero nao pode estar em duas organizacoes EM TRIAL (por digitos); org paga nao e barrada por isso", async () => {
    const a = await mk("wa-num-a");
    const b = await mk("wa-num-b");
    const c = await mk("wa-num-c");
    for (const o of [a, b]) await setTrial(o.orgId, "zz-big");
    await setOrgPlan(c.orgId, { planKey: "zz-big", status: "active", trialEndsAt: null });
    fake.current = new FakeWhatsAppProvider();
    const tag = `zz065n${Math.random().toString(36).slice(2, 6)}`;
    await asOwner(a);
    expect((await createWhatsAppInstance({ instanceName: `${tag}-a`, number: "(11) 98888-7766" })).ok).toBe(true);
    await asOwner(b);
    const r = await createWhatsAppInstance({ instanceName: `${tag}-b`, number: "+55 11 98888 7766" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.number?.[0]).toMatch(/outra organização/);
    await asOwner(c);
    expect((await createWhatsAppInstance({ instanceName: `${tag}-c`, number: "(11) 98888-7766" })).ok).toBe(true);
  });
});

describe("maxEmailAccounts", () => {
  const acct = (n: number) => ({ provider: "smtp", smtpHost: "smtp.example.com", port: 587, email: `zz065-${n}-${Math.random().toString(36).slice(2, 6)}@example.com`, password: "x" });
  it("1a ok, 2a barrada; 5 em paralelo com cota 1 => exatamente 1", async () => {
    const o = await mk("mail");
    await setTrial(o.orgId, "zz-lim1");
    await asOwner(o);
    expect((await createEmailAccount(acct(1))).ok).toBe(true);
    expect(errCode(await createEmailAccount(acct(2)))).toBe("plan_limit");
    const o2 = await mk("mail-race");
    await setTrial(o2.orgId, "zz-lim1");
    await asOwner(o2);
    const rs = await Promise.all([1, 2, 3, 4, 5].map((i) => createEmailAccount(acct(i))));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(await prisma.emailAccount.count({ where: { orgId: o2.orgId } })).toBe(1);
  });
});

describe("maxLeadsPerMonth (createLeadCore: ponto unico)", () => {
  const lead = (campaignId: string, n: number) => ({ campaignId, name: `Lead ${n}`, email: `zz065-l${n}-${Math.random().toString(36).slice(2, 7)}@example.com` });
  it("createLead: ate a cota; apagar lead NAO devolve cota; duplicado nao consome; plan_limit com {metric,limit,used}", async () => {
    const o = await mk("lead");
    await setTrial(o.orgId, "zz-lim1");
    await asOwner(o);
    const camp = await mkCampaign(o);
    const created: string[] = [];
    for (let i = 0; i < 2; i++) {
      const r = await createLead(lead(camp, i));
      expect(r.ok).toBe(true);
      if (r.ok) created.push(r.data.id);
    }
    const first = await prisma.lead.findUniqueOrThrow({ where: { id: created[0] } });
    const dup = await createLead({ campaignId: camp, name: "dup", email: first.email! });
    expect(dup.ok).toBe(false);
    expect(errCode(dup)).toBeUndefined(); // duplicado: erro de campo, nao de plano
    expect((await createLead(lead(camp, 2))).ok).toBe(true); // 3a ainda cabe (duplicado nao consumiu)
    const blocked = await createLead(lead(camp, 3));
    expect(errCode(blocked)).toBe("plan_limit");
    if (!blocked.ok) expect(blocked.errors).toMatchObject({ metric: ["leads"], limit: ["3"], used: ["3"] });
    // criar, apagar, criar: contar linhas permitiria burlar; o contador atomico nao
    await prisma.touch.deleteMany({ where: { leadId: created[0] } });
    await prisma.stageHistory.deleteMany({ where: { opportunity: { leadId: created[0] } } });
    await prisma.opportunity.deleteMany({ where: { leadId: created[0] } });
    await prisma.lead.delete({ where: { id: created[0] } });
    expect(errCode(await createLead(lead(camp, 4)))).toBe("plan_limit");
    const row = await prisma.usageCounter.findUniqueOrThrow({ where: { orgId_metric_periodKey: { orgId: o.orgId, metric: "leads", periodKey: "trial" } } });
    expect(row.count).toBe(3);
  });
  it("concorrencia: 8 createLead em paralelo com cota 3 => exatamente 3 criados", async () => {
    const o = await mk("lead-race");
    await setTrial(o.orgId, "zz-lim1");
    await asOwner(o);
    const camp = await mkCampaign(o);
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => createLead(lead(camp, i))));
    expect(rs.filter((r) => r.ok)).toHaveLength(3);
    expect(await prisma.lead.count({ where: { campaignId: camp } })).toBe(3);
  });
  it("plano pago: janela = mes civil BRT (virada de mes devolve a cota); trial: chave `trial` independente do mes", async () => {
    const o = await mk("lead-month");
    await setOrgPlan(o.orgId, { planKey: "zz-lim1", status: "active", trialEndsAt: null });
    await asOwner(o);
    const camp = await mkCampaign(o);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-30T15:00:00Z"));
    await asOwner(o); // sessao nova na data simulada (o JWT tem validade)
    for (let i = 0; i < 3; i++) expect((await createLead(lead(camp, i))).ok).toBe(true);
    expect(errCode(await createLead(lead(camp, 9)))).toBe("plan_limit");
    expect((await prisma.usageCounter.findFirstOrThrow({ where: { orgId: o.orgId, metric: "leads" } })).periodKey).toBe("2026-11");
    vi.setSystemTime(new Date("2026-12-01T15:00:00Z"));
    await asOwner(o);
    expect((await createLead(lead(camp, 10))).ok).toBe(true);
    expect((await prisma.usageCounter.findMany({ where: { orgId: o.orgId, metric: "leads" } })).map((c) => c.periodKey).sort()).toEqual(["2026-11", "2026-12"]);
  });
  it("trial atravessando a virada do mes NAO ganha cota nova (chave `trial` fixa)", async () => {
    const o = await mk("lead-trial-month");
    await setTrial(o.orgId, "zz-lim1");
    await asOwner(o);
    const camp = await mkCampaign(o);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now()));
    for (let i = 0; i < 3; i++) expect((await createLead(lead(camp, i))).ok).toBe(true);
    vi.setSystemTime(new Date(Date.now() + 40 * DAY));
    // (a org fica expirada nessa data; o contador `trial` e o que interessa: continua cheio)
    const row = await prisma.usageCounter.findUniqueOrThrow({ where: { orgId_metric_periodKey: { orgId: o.orgId, metric: "leads", periodKey: "trial" } } });
    expect(row.count).toBe(3);
    expect(await reserveUsage(prisma, o.orgId, "leads", "trial", 1, 3)).toMatchObject({ ok: false });
  });
  it("ingestao por webhook: cria ate a cota, PARA e devolve parcial 200 (limitReached), sem 500; org expirada => 403 tipado", async () => {
    const o = await mk("ingest");
    await setTrial(o.orgId, "zz-lim1");
    const camp = await mkCampaign(o);
    const body = (n: number) => JSON.stringify({ campaignId: camp, leads: Array.from({ length: n }, (_, i) => ({ name: `Ing ${i}`, email: `zz065-ing${i}-${Math.random().toString(36).slice(2, 7)}@example.com` })) });
    const req = (b: string) => new Request("http://app.test/api/integrations/leads", { method: "POST", headers: { authorization: "Bearer segredo-de-teste-065", "content-type": "application/json" }, body: b });
    const res = await handleIngest(req(body(5)), { secret: "segredo-de-teste-065", enabled: true });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ total: 5, created: 3, limitReached: 2 });
    expect(json.results.filter((r: { status: string }) => r.status === "limit_reached")).toHaveLength(2);
    expect(await prisma.lead.count({ where: { campaignId: camp } })).toBe(3);

    await setTrial(o.orgId, "zz-lim1", true);
    const denied = await handleIngest(req(body(1)), { secret: "segredo-de-teste-065", enabled: true });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: "trial_expired" });
    expect(await prisma.lead.count({ where: { campaignId: camp } })).toBe(3);
  });
  it("lead-source (Google/Meta): cota esgotada => status plan_limit (sem 500, chave liberada); org expirada => trial_expired", async () => {
    const o = await mk("lead-source");
    await setTrial(o.orgId, "zz-lim1");
    const camp = await mkCampaign(o);
    const run = (n: number) => ingestExternalLead({ source: "google_ads_leads", orgId: o.orgId, campaignId: camp, externalLeadId: `zz065-${o.orgId}-${n}`, contact: { name: `L${n}`, email: `zz065-ls${n}-${Math.random().toString(36).slice(2, 6)}@example.com`, phone: null, company: null, rawData: {} } });
    for (let i = 0; i < 3; i++) expect((await run(i)).status).toBe("created");
    expect((await run(3)).status).toBe("plan_limit");
    expect(await prisma.webhookEvent.count({ where: { orgId: o.orgId, source: "google_ads_leads" } })).toBe(3); // a chave do 4o foi liberada
    await setTrial(o.orgId, "zz-lim1", true);
    expect((await run(4)).status).toBe("trial_expired");
  });
});

describe("maxSendsPerDay (reserve.ts: ponto de estrangulamento)", () => {
  // `now` simulado em 2026-11/12: o trial precisa estar vigente nessas datas.
  const setFarTrial = (orgId: string) => setOrgPlan(orgId, { planKey: "zz-lim1", status: "trialing", trialEndsAt: new Date("2027-06-01T00:00:00Z") });
  async function mkTouches(o: TestOrg, n: number, channel: "email" | "whatsapp" = "email") {
    const camp = await mkCampaign(o);
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const lead = await prisma.lead.create({ data: { campaignId: camp, name: `S${i}`, email: `zz065-s${i}-${Math.random().toString(36).slice(2, 6)}@example.com`, phone: `+55119${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`, source: "manual" }, select: { id: true } });
      ids.push((await prisma.touch.create({ data: { leadId: lead.id, channel, status: "scheduled", scheduledAt: new Date() }, select: { id: true } })).id);
    }
    return ids;
  }
  const where = (id: string) => reservableWhere(id, 60_000);

  it("adia (nao falha) acima do limite diario: Touch volta a `scheduled` no proximo dia BRT, sem queimar tentativa; no dia seguinte passa; lido o MENOR dos limites", async () => {
    const o = await mk("sends");
    await setFarTrial(o.orgId);
    const ids = await mkTouches(o, 4);
    const now = new Date("2026-11-30T15:00:00Z");
    expect(await deferOverPlanBeforeReserve(ids[0], where(ids[0]), now)).toBeNull();
    expect(await deferOverPlanBeforeReserve(ids[1], where(ids[1]), now)).toBeNull();
    const d = await deferOverPlanBeforeReserve(ids[2], where(ids[2]), now);
    expect(d).toMatchObject({ reason: "plan_limit" });
    expect(d!.nextAt.toISOString()).toBe("2026-12-01T03:01:00.000Z");
    const t = await prisma.touch.findUniqueOrThrow({ where: { id: ids[2] } });
    expect(t).toMatchObject({ status: "scheduled", attempts: 0, error: PLAN_SEND_LIMIT_MESSAGE });
    expect(t.scheduledAt!.toISOString()).toBe("2026-12-01T03:01:00.000Z");
    // no dia seguinte a cota diaria e nova
    expect(await deferOverPlanBeforeReserve(ids[2], where(ids[2]), new Date("2026-12-01T15:00:00Z"))).toBeNull();
  });
  it("concorrencia: 6 envios simultaneos com limite 2/dia => exatamente 2 passam", async () => {
    const o = await mk("sends-race");
    await setFarTrial(o.orgId);
    const ids = await mkTouches(o, 6);
    const now = new Date("2026-11-30T15:00:00Z");
    const rs = await Promise.all(ids.map((id) => deferOverPlanBeforeReserve(id, where(id), now)));
    expect(rs.filter((r) => r === null)).toHaveLength(2);
  });
  it("sendEmail e sendWhatsApp (todos os callers passam aqui): 3o envio do dia => deferred/plan_limit; org A nao consome a cota da B", async () => {
    const a = await mk("sends-a");
    const b = await mk("sends-b");
    await setFarTrial(a.orgId);
    await setFarTrial(b.orgId);
    const ta = await mkTouches(a, 3, "email");
    const tw = await mkTouches(b, 3, "whatsapp");
    const now = new Date("2026-11-30T15:00:00Z");
    const ra = [];
    for (const id of ta) ra.push(await sendEmail(id, { now }));
    expect(ra[2]).toMatchObject({ status: "deferred", reason: "plan_limit" });
    expect(ra[0].status).not.toBe("deferred"); // 1o e 2o seguem o fluxo normal (aqui falham por falta de conta: irrelevante)
    const rb = [];
    for (const id of tw) rb.push(await sendWhatsApp(id, { now }));
    expect(rb[2]).toMatchObject({ status: "deferred", reason: "plan_limit" });
    expect(rb[0]).not.toMatchObject({ reason: "plan_limit" }); // B tem a propria cota
  });
  it("org com trial EXPIRADO: envio adiado (trial_expired); cortesia/sem Subscription/plano sem limite: sem limite diario", async () => {
    const e = await mk("sends-exp");
    await setTrial(e.orgId, "zz-lim1", true);
    const [te] = await mkTouches(e, 1);
    expect(await deferOverPlanBeforeReserve(te, where(te), new Date())).toMatchObject({ reason: "trial_expired" });
    expect((await prisma.touch.findUniqueOrThrow({ where: { id: te } })).status).toBe("scheduled");

    const u = await mk("sends-unl");
    const ids = await mkTouches(u, 5);
    for (const id of ids) expect(await deferOverPlanBeforeReserve(id, where(id), new Date())).toBeNull(); // sem Subscription
    await setOrgPlan(u.orgId, { planKey: "courtesy", status: "active", trialEndsAt: null });
    for (const id of ids) expect(await deferOverPlanBeforeReserve(id, where(id), new Date())).toBeNull();
    await setOrgPlan(u.orgId, { planKey: "zz-unl", status: "active", trialEndsAt: null });
    for (const id of ids) expect(await deferOverPlanBeforeReserve(id, where(id), new Date())).toBeNull();
    expect(await prisma.usageCounter.count({ where: { orgId: u.orgId } })).toBe(0);
  });
});

describe("app movel (setCampaignStatus) respeita maxCampaigns (QA 065a)", () => {
  it("retomar via movel e barrado no limite (409) e pausar nunca; com vaga, retoma", async () => {
    const { setCampaignStatus } = await import("@/lib/mobile/actions");
    const o = await mk("mobile");
    await setTrial(o.orgId, "zz-lim1");
    const active = await mkCampaign(o, "active");
    const paused = await mkCampaign(o, "paused");
    const auth = { userId: o.userId, deviceId: "d" } as never;
    const blocked = await setCampaignStatus(auth, paused, "active");
    expect(blocked).toMatchObject({ ok: false, status: 409 });
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: paused } })).status).toBe("paused");
    expect((await setCampaignStatus(auth, active, "paused")).ok).toBe(true);
    expect((await setCampaignStatus(auth, paused, "active")).ok).toBe(true);
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: paused } })).status).toBe("active");
  });
});
