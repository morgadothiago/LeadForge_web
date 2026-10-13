import "dotenv/config";
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");

import { prisma } from "@/lib/prisma";
import { signOut } from "@/lib/auth/test-helpers";
import { purgeTestOrg } from "@/lib/test-utils/org-fixture";
import { mkCampaign } from "@/lib/test-utils/trial-fixture";
import { PLANS, asOwner, changePlan, ensureGarbagePlan, errCode, mkPlanOrg, uniq, type PlanOrg } from "@/lib/test-utils/entitlements-fixture";
import { PlanFeatureLockedError } from "./entitlements";
import {
  approveDraft, bulkApproveFollowups, createAgent, rejectDraftAction, setAgentActive, setAgentAutonomy, simulateAgentAction, updateAgentSettings, updateAgent, saveKnowledge,
} from "@/lib/actions/agent";
import { runAgentTask } from "@/lib/agents/run-agent";
import { enqueueAgentRun, findActiveCloser, isAgentAvailable, processAgentQueue } from "@/lib/agents/queue";
import { dispatchDraft } from "@/lib/agents/drafts";
import { FakeLlmProvider } from "@/lib/agents/provider";
import { runnableAgentIds } from "@/lib/agents/plan-gate";
import { getEntitlements } from "./entitlements";

/**
 * SPEC-069b — agentes: actions (papel/autonomia/limite de ativos/IA), defesa em profundidade no runner/fila/envio (fail-closed em IA e envio;
 * leitura continua), teto de IA e mensagens/dia do plano, downgrade/past_due sem apagar nada, isolamento entre orgs.
 */
const orgs: PlanOrg[] = [];
const mk = async (tag: string, plan: string, opts: Parameters<typeof mkPlanOrg>[2] = {}) => {
  const o = await mkPlanOrg(tag, plan, opts);
  orgs.push(o);
  await prisma.agentSettings.upsert({ where: { orgId: o.orgId }, create: { orgId: o.orgId, killSwitch: false }, update: { killSwitch: false } });
  return o;
};
type Role = "sdr" | "followup" | "closer";
const mkAgent = (o: PlanOrg, role: Role, over: Record<string, unknown> = {}) =>
  prisma.agent.create({ data: { orgId: o.orgId, role, name: `zz069b-${role}-${uniq()}`, active: true, monthlyBudgetCents: 1000, dailyMessageLimit: 1000, allowedTools: [], ...over } });
let n = 0;
const mkLead = async (o: PlanOrg, campId: string) => {
  n++;
  return prisma.lead.create({ data: { campaignId: campId, name: `Ana ${n}`, company: "Acme", email: `l${n}-${uniq()}@zz069b.com`, phone: `+5511${String(910000000 + n * 7 + (Date.now() % 100000))}`, sequenceStatus: "active" } });
};
async function mkRun(o: PlanOrg, agentId: string, campId?: string) {
  const camp = campId ?? (await mkCampaign(o));
  const lead = await mkLead(o, camp);
  const run = await prisma.agentRun.create({ data: { agentId, leadId: lead.id, trigger: `step-${Math.random()}`, status: "running" } });
  return { run, lead, camp };
}
const runStatus = async (id: string) => (await prisma.agentRun.findUniqueOrThrow({ where: { id } })).status;

afterEach(() => signOut());
afterAll(async () => {
  for (const o of orgs) {
    await prisma.draft.deleteMany({ where: { lead: { campaign: { orgId: o.orgId } } } });
    await prisma.agentRun.deleteMany({ where: { agent: { orgId: o.orgId } } });
    await prisma.agent.deleteMany({ where: { orgId: o.orgId } });
    await prisma.agentSettings.deleteMany({ where: { orgId: o.orgId } });
    await prisma.orgEntitlementOverride.deleteMany({ where: { orgId: o.orgId } });
    await purgeTestOrg(o);
  }
});

// -------------------------------------------------------------------------------------------------------------------------------
describe("actions de agente: papel x plano", () => {
  const ROLES: Record<string, Role[]> = { free: [], starter: ["followup"], pro: ["sdr", "followup", "closer"], business: ["sdr", "followup", "closer"], courtesy: ["sdr", "followup", "closer"] };
  const NEEDS: Record<Role, string> = { sdr: "Pro", followup: "Starter", closer: "Pro" };
  for (const plan of PLANS) {
    for (const role of ["sdr", "followup", "closer"] as const) {
      const allowed = ROLES[plan].includes(role);
      it(`${plan}: createAgent ${role} ${allowed ? "liberado" : "barrado"}`, async () => {
        const o = await mk("ag-create", plan);
        await asOwner(o);
        const r = await createAgent({ name: `zz069b-${uniq()}`, role });
        if (allowed) expect(r.ok).toBe(true);
        else {
          expect(errCode(r)).toBe("plan_feature_locked");
          expect(!r.ok && r.errors.requiredPlan?.[0]).toBe(NEEDS[role]);
          expect(!r.ok && r.errors._form?.[0]).toContain(`plano ${NEEDS[role]}`);
          expect(await prisma.agent.count({ where: { orgId: o.orgId } })).toBe(0);
        }
      });
    }
  }

  it("Free: ativar agente barrado no servidor (agente criado antes/por downgrade); DESLIGAR nunca e barrado", async () => {
    const o = await mk("ag-free-act", "free");
    const a = await mkAgent(o, "followup", { active: false });
    await asOwner(o);
    expect(errCode(await setAgentActive({ id: a.id, active: true }))).toBe("plan_feature_locked");
    expect((await prisma.agent.findUniqueOrThrow({ where: { id: a.id } })).active).toBe(false);
    const b = await mkAgent(o, "followup", { active: true });
    expect((await setAgentActive({ id: b.id, active: false })).ok).toBe(true);
  });

  it("maxActiveAgents: Starter 1 (o 2o ativo e barrado com plan_limit/agents), Pro 3, Business sem teto; contagem por org", async () => {
    const st = await mk("ag-lim-st", "starter");
    const a1 = await mkAgent(st, "followup", { active: false });
    const a2 = await mkAgent(st, "followup", { active: false });
    await asOwner(st);
    expect((await setAgentActive({ id: a1.id, active: true })).ok).toBe(true);
    const r2 = await setAgentActive({ id: a2.id, active: true });
    expect(errCode(r2)).toBe("plan_limit");
    expect(!r2.ok && r2.errors.metric?.[0]).toBe("agents");
    expect(!r2.ok && r2.errors.limit?.[0]).toBe("1");

    const pro = await mk("ag-lim-pro", "pro");
    const ps = [await mkAgent(pro, "sdr", { active: false }), await mkAgent(pro, "sdr", { active: false }), await mkAgent(pro, "followup", { active: false }), await mkAgent(pro, "closer", { active: false })];
    await asOwner(pro);
    for (const p of ps.slice(0, 3)) expect((await setAgentActive({ id: p.id, active: true })).ok).toBe(true);
    expect(errCode(await setAgentActive({ id: ps[3].id, active: true }))).toBe("plan_limit");

    const biz = await mk("ag-lim-biz", "business");
    const bs = [await mkAgent(biz, "sdr", { active: false }), await mkAgent(biz, "sdr", { active: false }), await mkAgent(biz, "sdr", { active: false }), await mkAgent(biz, "sdr", { active: false })];
    await asOwner(biz);
    for (const b of bs) expect((await setAgentActive({ id: b.id, active: true })).ok).toBe(true);
    // a org Starter nao influenciou a Pro: isolamento
    expect(await prisma.agent.count({ where: { orgId: st.orgId, active: true } })).toBe(1);
  });

  it("maxActiveAgents sob corrida: 3 ativacoes simultaneas no Starter => exatamente 1 vence (lock da org)", async () => {
    const o = await mk("ag-race", "starter");
    const as = [await mkAgent(o, "followup", { active: false }), await mkAgent(o, "followup", { active: false }), await mkAgent(o, "followup", { active: false })];
    const { runWithSession } = await import("@/lib/auth/test-helpers");
    const rs = await Promise.all(as.map((a) => runWithSession(o.userId, o.orgId, () => setAgentActive({ id: a.id, active: true }))));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(await prisma.agent.count({ where: { orgId: o.orgId, active: true } })).toBe(1);
  });

  it("past_due: nao ativa agente (IA pausa); desligar segue liberado", async () => {
    const o = await mk("ag-pd-act", "pro", { status: "past_due" });
    const a = await mkAgent(o, "sdr", { active: false });
    await asOwner(o);
    const r = await setAgentActive({ id: a.id, active: true });
    expect(errCode(r)).toBe("plan_feature_locked");
    expect(!r.ok && r.errors._form?.[0]).toMatch(/pagamento em atraso/);
  });

  it("autonomia: Starter so rascunho (sampled/auto barrados, 'Pro'); Pro todas; voltar a rascunho sempre; Free barrado", async () => {
    const st = await mk("ag-aut-st", "starter");
    const a = await mkAgent(st, "followup", { active: false });
    await asOwner(st);
    for (const autonomy of ["sampled", "auto"] as const) {
      const r = await setAgentAutonomy({ id: a.id, autonomy });
      expect(errCode(r)).toBe("plan_feature_locked");
      expect(!r.ok && r.errors.requiredPlan?.[0]).toBe("Pro");
    }
    expect((await setAgentAutonomy({ id: a.id, autonomy: "draft" })).ok).toBe(true);

    const pro = await mk("ag-aut-pro", "pro");
    const p = await mkAgent(pro, "sdr", { active: false });
    await asOwner(pro);
    expect((await setAgentAutonomy({ id: p.id, autonomy: "sampled" })).ok).toBe(true);
    expect((await setAgentAutonomy({ id: p.id, autonomy: "auto" })).ok).toBe(true);
    expect((await setAgentAutonomy({ id: p.id, autonomy: "draft" })).ok).toBe(true);

    const free = await mk("ag-aut-free", "free");
    const f = await mkAgent(free, "sdr", { active: false });
    await asOwner(free);
    expect(errCode(await setAgentAutonomy({ id: f.id, autonomy: "auto" }))).toBe("plan_feature_locked");
    expect((await setAgentAutonomy({ id: f.id, autonomy: "draft" })).ok).toBe(true);
  });

  it("kill switch: Free nao consegue DESLIGAR (ligar IA); ligar (parar tudo) sempre; Starter desliga", async () => {
    const free = await mk("ag-ks-free", "free");
    await asOwner(free);
    expect(errCode(await updateAgentSettings({ killSwitch: false }))).toBe("plan_feature_locked");
    expect((await updateAgentSettings({ killSwitch: true })).ok).toBe(true);
    const st = await mk("ag-ks-st", "starter");
    await asOwner(st);
    expect((await updateAgentSettings({ killSwitch: false })).ok).toBe(true);
  });

  it("simulacao (gasta tokens) e envio de rascunhos: Free e past_due barrados; conteudo (persona/base) continua editavel em qualquer plano", async () => {
    const free = await mk("ag-sim-free", "free");
    const fa = await mkAgent(free, "followup", { active: false });
    await asOwner(free);
    expect(errCode(await simulateAgentAction({ agentId: fa.id }))).toBe("plan_feature_locked");
    expect(errCode(await bulkApproveFollowups({ ids: ["00000000-0000-4000-8000-000000000000"] }))).toBe("plan_feature_locked");
    expect((await updateAgent({ id: fa.id, persona: "Persona nova" })).ok).toBe(true);
    expect((await saveKnowledge({ agentId: fa.id, title: "Base", content: "Conteudo" })).ok).toBe(true);

    const pd = await mk("ag-sim-pd", "pro", { status: "past_due" });
    const pa = await mkAgent(pd, "sdr", { active: false });
    await asOwner(pd);
    const r = await simulateAgentAction({ agentId: pa.id });
    expect(errCode(r)).toBe("plan_feature_locked");
    expect(!r.ok && r.errors._form?.[0]).toMatch(/pagamento em atraso/);
  });

  it("aprovar rascunho: Free barrado (rascunho segue pendente); Starter passa da trava; past_due barra; rejeitar nunca e barrado", async () => {
    const free = await mk("ag-apv-free", "free");
    const fa = await mkAgent(free, "followup");
    const { run, lead } = await mkRun(free, fa.id);
    const d = await prisma.draft.create({ data: { agentRunId: run.id, leadId: lead.id, channel: "whatsapp", body: "Oi", status: "pending" } });
    await asOwner(free);
    expect(errCode(await approveDraft({ id: d.id }))).toBe("plan_feature_locked");
    expect((await prisma.draft.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("pending");
    expect((await rejectDraftAction({ id: d.id, reason: "nao" })).ok).toBe(true);

    const st = await mk("ag-apv-st", "starter");
    const sa = await mkAgent(st, "followup");
    const sr = await mkRun(st, sa.id);
    const sd = await prisma.draft.create({ data: { agentRunId: sr.run.id, leadId: sr.lead.id, channel: "whatsapp", body: "Oi", status: "pending" } });
    await asOwner(st);
    expect(errCode(await approveDraft({ id: sd.id }))).not.toBe("plan_feature_locked");

    const pd = await mk("ag-apv-pd", "pro", { status: "past_due" });
    const pa = await mkAgent(pd, "sdr");
    const pr = await mkRun(pd, pa.id);
    const pdd = await prisma.draft.create({ data: { agentRunId: pr.run.id, leadId: pr.lead.id, channel: "whatsapp", body: "Oi", status: "pending" } });
    await asOwner(pd);
    expect(errCode(await approveDraft({ id: pdd.id }))).toBe("plan_feature_locked");
    expect((await prisma.draft.findUniqueOrThrow({ where: { id: pdd.id } })).status).toBe("pending");
  });

  it("dispatchDraft (ponto unico de envio de agente): lanca PlanFeatureLockedError ANTES de consumir o rascunho, tambem no automatico (reviewer null)", async () => {
    const o = await mk("ag-disp", "free");
    const a = await mkAgent(o, "sdr");
    const { run, lead } = await mkRun(o, a.id);
    const d = await prisma.draft.create({ data: { agentRunId: run.id, leadId: lead.id, channel: "whatsapp", body: "Oi", status: "pending" } });
    await expect(dispatchDraft(d.id, { reviewer: null })).rejects.toBeInstanceOf(PlanFeatureLockedError);
    await expect(dispatchDraft(d.id, { reviewer: o.userId, orgId: o.orgId })).rejects.toBeInstanceOf(PlanFeatureLockedError);
    expect((await prisma.draft.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("pending");
    expect(await prisma.touch.count({ where: { leadId: lead.id } })).toBe(0);
  });
});

// -------------------------------------------------------------------------------------------------------------------------------
describe("runner (runAgentTask): defesa em profundidade, fail-closed em IA e envio", () => {
  it("Free com agente ativo (ex.: downgrade): NAO chama a IA, tarefa fica queued, agente continua ativo (nada apagado)", async () => {
    const o = await mk("rn-free", "free");
    const a = await mkAgent(o, "followup");
    const { run } = await mkRun(o, a.id);
    const fake = new FakeLlmProvider([{}]);
    expect(await runAgentTask({ runId: run.id, provider: fake })).toEqual({ status: "deferred", reason: "plan_locked" });
    expect(fake.calls).toHaveLength(0);
    expect(await runStatus(run.id)).toBe("queued");
    expect((await prisma.agent.findUniqueOrThrow({ where: { id: a.id } })).active).toBe(true);
  });

  it("Starter: follow-up roda (rascunho); SDR/Closer ativos ficam parados; agentes alem de maxActiveAgents ficam parados (o mais antigo tem prioridade)", async () => {
    const o = await mk("rn-st", "starter");
    const fu1 = await mkAgent(o, "followup");
    const sdr = await mkAgent(o, "sdr");
    const fu2 = await mkAgent(o, "followup");
    const r1 = await mkRun(o, fu1.id);
    const fake = new FakeLlmProvider([{}]);
    expect((await runAgentTask({ runId: r1.run.id, provider: fake })).status).toBe("draft");
    expect(fake.calls).toHaveLength(1);
    const r2 = await mkRun(o, sdr.id, r1.camp);
    const r3 = await mkRun(o, fu2.id, r1.camp);
    expect(await runAgentTask({ runId: r2.run.id, provider: fake })).toEqual({ status: "deferred", reason: "plan_locked" });
    expect(await runAgentTask({ runId: r3.run.id, provider: fake })).toEqual({ status: "deferred", reason: "plan_locked" });
    expect(fake.calls).toHaveLength(1);
    expect(runnableAgentIds(await getEntitlements(prisma, o.orgId), [fu1, sdr, fu2]).size).toBe(1);
  });

  it("autonomia alem do plano cai em REVISAO (nunca envia sozinho): Starter com agente 'auto' => rascunho; Pro com 'auto' => envia", async () => {
    const st = await mk("rn-auto-st", "starter");
    const sa = await mkAgent(st, "followup", { autonomy: "auto" });
    const sr = await mkRun(st, sa.id);
    expect((await runAgentTask({ runId: sr.run.id, provider: new FakeLlmProvider([{}]) })).status).toBe("draft");
    expect((await prisma.draft.findFirstOrThrow({ where: { leadId: sr.lead.id } })).status).toBe("pending");
    expect(await prisma.touch.count({ where: { leadId: sr.lead.id } })).toBe(0);

    const pro = await mk("rn-auto-pro", "pro");
    const pa = await mkAgent(pro, "sdr", { autonomy: "auto" });
    const pr = await mkRun(pro, pa.id);
    expect((await runAgentTask({ runId: pr.run.id, provider: new FakeLlmProvider([{}]) })).status).toBe("sent");
  });

  it("past_due: IA pausa ('plan_locked'); regularizou => volta a gerar; plano ilegivel e org Business suspensa tambem nao rodam", async () => {
    const o = await mk("rn-pd", "pro", { status: "past_due" });
    const a = await mkAgent(o, "sdr");
    const r = await mkRun(o, a.id);
    const fake = new FakeLlmProvider([{}]);
    expect(await runAgentTask({ runId: r.run.id, provider: fake })).toEqual({ status: "deferred", reason: "plan_locked" });
    expect(fake.calls).toHaveLength(0);
    await changePlan(o, "pro");
    await prisma.agentRun.update({ where: { id: r.run.id }, data: { status: "running" } });
    expect((await runAgentTask({ runId: r.run.id, provider: fake })).status).toBe("draft");

    await ensureGarbagePlan();
    const g = await mk("rn-garb", "starter");
    await changePlan(g, "zz-069b-garbage", "active");
    const ga = await mkAgent(g, "followup");
    const gr = await mkRun(g, ga.id);
    expect(await runAgentTask({ runId: gr.run.id, provider: fake })).toEqual({ status: "deferred", reason: "plan_locked" });

    const biz = await mk("rn-biz-susp", "business", { orgStatus: "suspended" });
    const ba = await mkAgent(biz, "sdr");
    const br = await mkRun(biz, ba.id);
    expect(await runAgentTask({ runId: br.run.id, provider: fake })).toEqual({ status: "deferred", reason: "plan_locked" });
    expect(fake.calls).toHaveLength(1);
  });

  it("teto de IA do plano (por org, centavos): estourou => deferred/budget_exhausted; outra org no mesmo plano nao e afetada; Business sem teto", async () => {
    const a = await mk("rn-bud-a", "starter"); // teto 5000 centavos
    const b = await mk("rn-bud-b", "starter");
    const aa = await mkAgent(a, "followup", { monthlyBudgetCents: 100_000 });
    const ba = await mkAgent(b, "followup", { monthlyBudgetCents: 100_000 });
    const ra = await mkRun(a, aa.id);
    // gasta o teto do PLANO da org A (nao o do agente): 5000 centavos = 50_000_000 micros
    const spent = await mkRun(a, aa.id, ra.camp);
    await prisma.agentRun.update({ where: { id: spent.run.id }, data: { costMicros: 5000 * 10_000, status: "completed" } });
    const fake = new FakeLlmProvider([{}]);
    expect(await runAgentTask({ runId: ra.run.id, provider: fake })).toEqual({ status: "deferred", reason: "budget_exhausted" });
    expect(fake.calls).toHaveLength(0);
    expect(await runStatus(ra.run.id)).toBe("queued");
    const rb = await mkRun(b, ba.id);
    expect((await runAgentTask({ runId: rb.run.id, provider: fake })).status).toBe("draft"); // gasto da A nao entra na B
    const biz = await mk("rn-bud-biz", "business");
    const bz = await mkAgent(biz, "sdr", { monthlyBudgetCents: 100_000 });
    const brz = await mkRun(biz, bz.id);
    const sp = await mkRun(biz, bz.id, brz.camp);
    await prisma.agentRun.update({ where: { id: sp.run.id }, data: { costMicros: 99_000 * 10_000, status: "completed" } });
    expect((await runAgentTask({ runId: brz.run.id, provider: fake })).status).toBe("draft");
  });

  it("mensagens/dia do plano (Starter 20): vale o MENOR entre o limite do agente (1000) e o do plano", async () => {
    const o = await mk("rn-msg", "starter");
    const a = await mkAgent(o, "followup", { dailyMessageLimit: 1000 });
    const first = await mkRun(o, a.id);
    for (let i = 0; i < 20; i++) {
      const l = await mkLead(o, first.camp);
      const rr = await prisma.agentRun.create({ data: { agentId: a.id, leadId: l.id, trigger: `msg-${i}-${Math.random()}`, status: "completed" } });
      await prisma.draft.create({ data: { agentRunId: rr.id, leadId: l.id, channel: "whatsapp", body: "x", status: "pending" } });
    }
    const fake = new FakeLlmProvider([{}]);
    expect(await runAgentTask({ runId: first.run.id, provider: fake })).toEqual({ status: "deferred", reason: "daily_limit" });
    expect(fake.calls).toHaveLength(0);
  });

  it("downgrade Pro -> Starter -> upgrade: os 3 agentes seguem ativos no banco; so o permitido roda; upgrade reativa todos sem perda", async () => {
    const o = await mk("rn-dg", "pro");
    const sdr = await mkAgent(o, "sdr");
    const fu = await mkAgent(o, "followup");
    const cl = await mkAgent(o, "closer");
    const camp = await mkCampaign(o);
    const run = async (a: { id: string }) => (await mkRun(o, a.id, camp)).run.id;
    const fake = new FakeLlmProvider([{}]);
    await changePlan(o, "starter");
    expect(await prisma.agent.count({ where: { orgId: o.orgId, active: true } })).toBe(3); // nada desativado/apagado
    // Starter: maxActiveAgents=1 e so follow-up => o follow-up (unico papel liberado) roda; SDR e Closer ficam parados
    expect((await runAgentTask({ runId: await run(fu), provider: fake })).status).toBe("draft");
    expect(await runAgentTask({ runId: await run(sdr), provider: fake })).toEqual({ status: "deferred", reason: "plan_locked" });
    expect(await runAgentTask({ runId: await run(cl), provider: fake })).toEqual({ status: "deferred", reason: "plan_locked" });
    await changePlan(o, "pro");
    expect((await runAgentTask({ runId: await run(sdr), provider: fake })).status).toBe("draft");
    expect((await runAgentTask({ runId: await run(cl), provider: fake })).status).toBe("draft");
    expect(await prisma.agent.count({ where: { orgId: o.orgId, active: true } })).toBe(3);
  });
});

// -------------------------------------------------------------------------------------------------------------------------------
describe("fila/tick (processAgentQueue, isAgentAvailable, findActiveCloser)", () => {
  it("tarefas de org Free/past_due ficam queued SEM travar a fila das demais (Pro e processada no mesmo lote)", async () => {
    const free = await mk("q-free", "free");
    const pd = await mk("q-pd", "pro", { status: "past_due" });
    const pro = await mk("q-pro", "pro");
    const fa = await mkAgent(free, "followup");
    const pa = await mkAgent(pd, "sdr");
    const oa = await mkAgent(pro, "sdr");
    const mkQueued = async (o: PlanOrg, a: { id: string }) => {
      const lead = await mkLead(o, await mkCampaign(o));
      return prisma.agentRun.create({ data: { agentId: a.id, leadId: lead.id, trigger: `step-${Math.random()}`, status: "queued", createdAt: new Date(Date.now() - 3_600_000) } });
    };
    const rf = await mkQueued(free, fa);
    const rp = await mkQueued(pd, pa);
    const ro = await mkQueued(pro, oa);
    const fake = new FakeLlmProvider([{}]);
    await processAgentQueue({ provider: fake, limit: 200, budgetMs: 60_000 });
    expect(await runStatus(rf.id)).toBe("queued");
    expect(await runStatus(rp.id)).toBe("queued");
    expect(["completed", "running"]).toContain(await runStatus(ro.id));
    // regularizou o pagamento: a tarefa guardada e processada no proximo tick
    await changePlan(pd, "pro");
    await processAgentQueue({ provider: fake, limit: 200, budgetMs: 60_000 });
    expect(await runStatus(rp.id)).toBe("completed");
  });

  it("isAgentAvailable (tick enfileira so se couber no plano) e findActiveCloser (Closer so no Pro+)", async () => {
    const st = await mk("q-av-st", "starter");
    const sdr = await mkAgent(st, "sdr");
    const fu = await mkAgent(st, "followup");
    expect(await isAgentAvailable(sdr.id)).toBe(false);
    expect(await isAgentAvailable(fu.id)).toBe(true);
    await mkAgent(st, "closer");
    expect(await findActiveCloser(st.orgId)).toBeNull();
    const pro = await mk("q-av-pro", "pro");
    const c = await mkAgent(pro, "closer");
    expect((await findActiveCloser(pro.orgId))?.id).toBe(c.id);
    await changePlan(pro, "pro", "past_due");
    expect(await findActiveCloser(pro.orgId)).toBeNull();
    expect(await isAgentAvailable(c.id)).toBe(false);
    const lead = await mkLead(pro, await mkCampaign(pro));
    expect(await enqueueAgentRun({ agentId: c.id, leadId: lead.id, trigger: "inbound:1" })).toBe(true); // enfileirar e barato; quem decide rodar e o runner
  });
});
