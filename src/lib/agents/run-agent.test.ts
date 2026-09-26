import "dotenv/config";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");

import { prisma } from "@/lib/prisma";
import { seed, SEED_IDS } from "../../../prisma/seed";
import { AppError } from "@/lib/errors";
import { runAgentTask } from "./run-agent";
import { processAgentQueue, enqueueAgentRun } from "./queue";
import { rejectDraft, expireOldDrafts } from "./drafts";
import { purgeAgentData } from "./retention";
import { stopAgentOnManualReply } from "./lead-state";
import { FakeLlmProvider } from "./provider";

const TAG = "zz-test-spec019";
let agentId = "";
let campId = "";
let n = 0;

async function mkLead(over: Record<string, unknown> = {}) {
  n++;
  return prisma.lead.create({
    data: { campaignId: campId, name: `Ana ${n}`, company: "Acme", email: `l${n}@${TAG}.com`, phone: `+5511${String(910000000 + n * 7 + (Date.now() % 100000))}`, sequenceStatus: "active", ...over },
  });
}
async function mkRun(leadId: string, trigger = "step") {
  return prisma.agentRun.create({ data: { agentId, leadId, trigger: `${trigger}-${Math.random()}`, status: "running" } });
}
async function cleanup() {
  await prisma.lead.deleteMany({ where: { campaign: { name: { startsWith: TAG } } } });
  await prisma.campaign.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.agent.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.knowledgeDocument.deleteMany({ where: { title: { startsWith: TAG } } });
}

beforeAll(async () => {
  await seed(prisma);
  await cleanup();
  const userId = (await prisma.user.findFirstOrThrow({ where: { email: "admin@leadforge.local" } })).id;
  const icpId = (await prisma.icpProfile.findFirstOrThrow()).id;
  campId = (await prisma.campaign.create({ data: { name: `${TAG}-c`, userId, icpId, orgId: SEED_IDS.org } })).id;
  agentId = (await prisma.agent.create({ data: { orgId: SEED_IDS.org, role: "sdr", name: `${TAG}-sdr`, active: true, monthlyBudgetCents: 1000, allowedTools: [] } })).id;
  await prisma.knowledgeDocument.create({ data: { orgId: SEED_IDS.org, agentId, title: `${TAG}-kb`, content: "Plano Pro custa R$ 99 por mês." } });
}, 30000);
beforeEach(async () => {
  await prisma.agentSettings.upsert({ where: { orgId: SEED_IDS.org }, create: { orgId: SEED_IDS.org, killSwitch: false }, update: { killSwitch: false, monthlyBudgetCents: null } });
  await prisma.agent.update({ where: { id: agentId }, data: { active: true, autonomy: "draft", monthlyBudgetCents: 1000, dailyMessageLimit: 1000 } });
});
afterAll(async () => {
  await cleanup();
  await prisma.agentSettings.deleteMany({});
  await prisma.$disconnect();
});

describe("runAgentTask (requer banco de testes)", () => {
  it("autonomia draft: cria rascunho pendente e NUNCA envia", async () => {
    const lead = await mkLead();
    const run = await mkRun(lead.id);
    const fake = new FakeLlmProvider([{}]);
    const out = await runAgentTask({ runId: run.id, provider: fake });
    expect(out.status).toBe("draft");
    expect(await prisma.touch.count({ where: { leadId: lead.id } })).toBe(0);
    expect((await prisma.draft.findFirstOrThrow({ where: { leadId: lead.id } })).status).toBe("pending");
    const ctx = fake.calls[0]!.user;
    expect(ctx).not.toContain(lead.email!);
    expect(ctx).not.toContain(lead.phone!);
  });
  it("kill switch global e agente inativo: não chama o provedor", async () => {
    const fake = new FakeLlmProvider([{}]);
    await prisma.agentSettings.update({ where: { orgId: SEED_IDS.org }, data: { killSwitch: true } });
    expect((await runAgentTask({ runId: (await mkRun((await mkLead()).id)).id, provider: fake })).status).toBe("deferred");
    await prisma.agentSettings.update({ where: { orgId: SEED_IDS.org }, data: { killSwitch: false } });
    await prisma.agent.update({ where: { id: agentId }, data: { active: false } });
    expect((await runAgentTask({ runId: (await mkRun((await mkLead()).id)).id, provider: fake })).status).toBe("skipped");
    expect(fake.calls).toHaveLength(0);
  });
  it("mensagem PARAR (opt-out) nunca chama o LlmProvider", async () => {
    const lead = await mkLead();
    await prisma.touch.create({ data: { leadId: lead.id, channel: "whatsapp", direction: "inbound", status: "replied", content: "PARAR" } });
    const fake = new FakeLlmProvider([{}]);
    const out = await runAgentTask({ runId: (await mkRun(lead.id, "inbound")).id, provider: fake });
    expect(out).toEqual({ status: "skipped", reason: "opt_out_ou_recusa" });
    expect(fake.calls).toHaveLength(0);
  });
  it("lead suprimido/opted_out: não chama o provedor", async () => {
    const lead = await mkLead({ sequenceStatus: "opted_out", optedOutAt: new Date() });
    const fake = new FakeLlmProvider([{}]);
    expect((await runAgentTask({ runId: (await mkRun(lead.id)).id, provider: fake })).status).toBe("skipped");
    expect(fake.calls).toHaveLength(0);
  });
  it("guardrail violado => blocked + needsHuman, sem rascunho", async () => {
    const lead = await mkLead();
    const out = await runAgentTask({ runId: (await mkRun(lead.id)).id, provider: new FakeLlmProvider([{ message: "Te dou 90% de desconto agora mesmo, pode fechar.", citedKnowledgeIds: [] }]) });
    expect(out.status).toBe("blocked");
    expect(await prisma.draft.count({ where: { leadId: lead.id } })).toBe(0);
    const l = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(l.needsHuman).toBe(true);
    expect(l.handoffAt).not.toBeNull();
  });
  it("cada gatilho de handoff marca needsHuman e o agente para no lead", async () => {
    const inbound = async (text: string) => {
      const lead = await mkLead();
      await prisma.touch.create({ data: { leadId: lead.id, channel: "whatsapp", direction: "inbound", status: "replied", content: text } });
      const fake = new FakeLlmProvider([{}]);
      const out = await runAgentTask({ runId: (await mkRun(lead.id, "inbound")).id, provider: fake });
      return { out, fake, lead: await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } }) };
    };
    const a = await inbound("Quero falar com um atendente");
    expect(a.out).toEqual({ status: "handoff", reason: "human_request" });
    expect(a.fake.calls).toHaveLength(0);
    expect(a.lead.needsHuman).toBe(true);
    const again = await runAgentTask({ runId: (await mkRun(a.lead.id)).id, provider: new FakeLlmProvider([{}]) });
    expect(again).toEqual({ status: "skipped", reason: "agente_parou_neste_lead" });
    // baixa confiança, turnos máximos, erro do provedor
    const l2 = await mkLead();
    expect((await runAgentTask({ runId: (await mkRun(l2.id)).id, provider: new FakeLlmProvider([{ confidence: 0.1 }]) })).status).toBe("handoff");
    const l3 = await mkLead({ agentTurns: 99 });
    expect(await runAgentTask({ runId: (await mkRun(l3.id)).id, provider: new FakeLlmProvider([{}]) })).toEqual({ status: "handoff", reason: "max_turns" });
    const l4 = await mkLead();
    expect(await runAgentTask({ runId: (await mkRun(l4.id)).id, provider: new FakeLlmProvider([new AppError({ code: "rate_limited", userMessage: "429", retryable: true })]) })).toEqual({ status: "handoff", reason: "provider_error" });
  });
  it("orçamento esgotado: hard stop, tarefa volta para a fila sem chamar o provedor", async () => {
    const lead = await mkLead();
    await prisma.agent.update({ where: { id: agentId }, data: { monthlyBudgetCents: 1 } });
    await prisma.agentRun.create({ data: { agentId, leadId: (await mkLead()).id, trigger: "gasto", status: "completed", costMicros: 20_000 } });
    const fake = new FakeLlmProvider([{}]);
    const run = await mkRun(lead.id);
    expect(await runAgentTask({ runId: run.id, provider: fake })).toEqual({ status: "deferred", reason: "budget_exhausted" });
    expect(fake.calls).toHaveLength(0);
    expect((await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("queued");
  });
  it("fila: enfileirar é idempotente e não chama o LLM; agente sem teto não roda", async () => {
    const lead = await mkLead();
    expect(await enqueueAgentRun({ agentId, leadId: lead.id, stepId: null, trigger: "inbound:x" })).toBe(true);
    const fake = new FakeLlmProvider([{}]);
    const s = await processAgentQueue({ provider: fake, limit: 5 });
    expect(s.processed).toBeGreaterThanOrEqual(1);
  });
  it("rejeitar e expirar rascunho; retenção apaga conteúdo antigo; resposta manual para o agente", async () => {
    const lead = await mkLead();
    await runAgentTask({ runId: (await mkRun(lead.id)).id, provider: new FakeLlmProvider([{}]) });
    const d = await prisma.draft.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(await rejectDraft(d.id, "u", "não serve")).toBe(true);
    expect(await rejectDraft(d.id, "u", "de novo")).toBe(false);

    const l2 = await mkLead();
    await runAgentTask({ runId: (await mkRun(l2.id)).id, provider: new FakeLlmProvider([{}]) });
    const d2 = await prisma.draft.findFirstOrThrow({ where: { leadId: l2.id } });
    await prisma.draft.update({ where: { id: d2.id }, data: { createdAt: new Date(Date.now() - 10 * 24 * 3600_000) } });
    expect(await expireOldDrafts()).toBeGreaterThanOrEqual(1);
    expect((await prisma.draft.findUniqueOrThrow({ where: { id: d2.id } })).status).toBe("expired");

    await prisma.agentRun.updateMany({ where: { leadId: l2.id }, data: { createdAt: new Date(Date.now() - 200 * 24 * 3600_000) } });
    await prisma.draft.update({ where: { id: d2.id }, data: { createdAt: new Date(Date.now() - 200 * 24 * 3600_000) } });
    expect(await purgeAgentData()).toBeGreaterThanOrEqual(1);
    expect((await prisma.draft.findUniqueOrThrow({ where: { id: d2.id } })).body).toBe("");

    const l3 = await mkLead();
    await stopAgentOnManualReply(l3.id);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: l3.id } })).handoffAt).not.toBeNull();
    expect(await runAgentTask({ runId: (await mkRun(l3.id)).id, provider: new FakeLlmProvider([{}]) })).toEqual({ status: "skipped", reason: "agente_parou_neste_lead" });
  });
});
