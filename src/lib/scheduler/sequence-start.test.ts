import "dotenv/config";
import { randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.AUTH_URL = "http://app.test";

import { prisma } from "@/lib/prisma";
import { seed } from "../../../prisma/seed";
import { signInAsSeedAdmin } from "@/lib/auth/test-helpers";
import { purgeTestCampaigns } from "@/lib/test-utils/purge";
import { encrypt } from "@/lib/crypto/secret-box";
import { sendEmail } from "@/lib/channels/email";
import { sendWhatsApp } from "@/lib/channels/whatsapp";
import { FakeWhatsAppProvider } from "@/lib/whatsapp/providers/fake";
import { activateLeads } from "@/lib/domain/sequence-start";
import { DAY_MS } from "./decide";
import { startCampaignSequences, startSequence, stopSequence } from "@/lib/actions/sequence-start";
import { countStartableLeads } from "@/lib/queries/sequence-start";
import { runTick, type TickDeps } from "./run-tick";

const TAG = "zz-test-spec013b";
/** B6: ticks com `Date.now()` criam SchedulerRun fora da janela de junho/2026; tudo criado a partir daqui é removido no cleanup. */
const SUITE_START = new Date();
const NOW = new Date("2026-06-08T13:30:00Z"); // segunda, SP 10:30
let userId = "";
let icpId = "";
let n = 0;
const seqs: string[] = [];
const fake = new FakeWhatsAppProvider();
const transport = nodemailer.createTransport({ jsonTransport: true });
const sendMail = vi.spyOn(transport, "sendMail");

async function mkCampaign(steps: ("email" | "whatsapp")[] = ["email"], over: Record<string, unknown> = {}) {
  n++;
  const name = `${TAG}-${n}`;
  const seq = await prisma.sequence.create({ data: { name } });
  seqs.push(seq.id);
  const camp = await prisma.campaign.create({ data: { name, userId, icpId, sequenceId: seq.id, ...over } });
  const tpl = await prisma.messageTemplate.create({ data: { campaignId: camp.id, channel: "email", name, subject: "Oi", body: "Olá {{firstName}}" } });
  for (const [i, channel] of steps.entries()) await prisma.sequenceStep.create({ data: { sequenceId: seq.id, day: i, channel, templateId: tpl.id, order: i + 1 } });
  return camp.id;
}
async function mkLead(campaignId: string, over: Record<string, unknown> = {}) {
  n++;
  return prisma.lead.create({ data: { campaignId, name: `Ana ${n}`, email: `l${n}@${TAG}.com`, phone: `+5511${String(900000000 + n * 7)}`, hasWhatsapp: true, ...over } });
}
const deps = (campaignIds: string[]): Partial<TickDeps> => ({
  campaignIds,
  sendEmail: (id, now) => sendEmail(id, { now, transport }),
  sendWhatsApp: (id, now) => sendWhatsApp(id, { now, provider: fake, rng: () => 0 }),
  evaluateHealth: async () => 0,
});
const tick = (campId: string, now = NOW) => runTick(now, deps([campId]));
const getLead = (id: string) => prisma.lead.findUniqueOrThrow({ where: { id } });
const touches = (leadId: string) => prisma.touch.findMany({ where: { leadId }, orderBy: { createdAt: "asc" } });

async function cleanup() {
  const ids = (await prisma.campaign.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } })).map((c) => c.id);
  if (ids.length) await prisma.webhookEvent.deleteMany({ where: { source: "sequence_audit", OR: ids.map((id) => ({ payload: { path: ["campaignId"], equals: id } })) } });
  await purgeTestCampaigns(TAG);
  await prisma.suppression.deleteMany({ where: { value: { contains: TAG } } });
  await prisma.emailAccount.deleteMany({ where: { email: { contains: TAG } } });
  await prisma.sequence.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.schedulerRun.deleteMany({ where: { startedAt: { gte: new Date("2026-06-01T00:00:00Z"), lt: new Date("2026-07-01T00:00:00Z") } } });
  await prisma.schedulerRun.deleteMany({ where: { startedAt: { gte: SUITE_START } } });
}

beforeAll(async () => {
  await seed(prisma);
  await cleanup();
  await signInAsSeedAdmin();
  userId = (await prisma.user.findFirstOrThrow({ where: { email: "admin@leadforge.local" } })).id;
  icpId = (await prisma.icpProfile.findFirstOrThrow()).id;
  await prisma.emailAccount.create({ data: { userId, provider: "smtp", smtpHost: "smtp.interno.local", email: `a@${TAG}.com`, encryptedPassword: encrypt("x"), dailyLimit: 1000 } });
}, 30000);

afterEach(() => {
  delete process.env.ALLOW_SEED_SENDS;
  sendMail.mockClear();
});
afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("dado de seed nunca é enviável", () => {
  it("Fila A e B ignoram source=seed (mesmo devido/agendado) e os canais barram; com ALLOW_SEED_SENDS=true libera", async () => {
    const c = await mkCampaign(["email", "email"]);
    const seedActive = await mkLead(c, { source: "seed", sequenceStatus: "active", nextTouchAt: new Date("2026-01-01") });
    const seedSched = await mkLead(c, { source: "seed", sequenceStatus: "active", nextTouchAt: new Date("2026-01-01") });
    const t = await prisma.touch.create({ data: { leadId: seedSched.id, stepId: (await prisma.sequenceStep.findFirstOrThrow({ where: { sequence: { campaigns: { some: { id: c } } }, order: 1 } })).id, channel: "email", status: "scheduled", scheduledAt: new Date("2026-01-01") } });
    const real = await mkLead(c, { sequenceStatus: "active", nextTouchAt: new Date("2026-01-01"), source: null });

    const r = await tick(c);
    expect(r.counters.result_sent).toBe(1); // só o real
    expect(await touches(seedActive.id)).toHaveLength(0);
    expect((await prisma.touch.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("scheduled");
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect((await touches(real.id))[0].status).toBe("sent");

    // defesa em profundidade: canal chamado direto no Touch de seed -> skipped sem transport
    sendMail.mockClear();
    const direct = await sendEmail(t.id, { now: NOW, transport });
    expect(direct).toEqual({ status: "skipped", reason: "seed_data" });
    expect(sendMail).not.toHaveBeenCalled();
    expect(await prisma.touch.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ status: "skipped", error: "dado de teste (seed)" });

    const cw = await mkCampaign(["whatsapp"]);
    const wl = await mkLead(cw, { source: "seed" });
    const wt = await prisma.touch.create({ data: { leadId: wl.id, stepId: (await prisma.sequenceStep.findFirstOrThrow({ where: { sequence: { campaigns: { some: { id: cw } } } } })).id, channel: "whatsapp", status: "scheduled", scheduledAt: NOW } });
    const before = fake.sent.length;
    expect(await sendWhatsApp(wt.id, { now: NOW, provider: fake, rng: () => 0 })).toEqual({ status: "skipped", reason: "seed_data" });
    expect(fake.sent.length).toBe(before);

    // com a env explícita (só dev): volta a ser enviável
    process.env.ALLOW_SEED_SENDS = "true";
    const t2 = await prisma.touch.create({ data: { leadId: seedActive.id, stepId: (await prisma.sequenceStep.findFirstOrThrow({ where: { sequence: { campaigns: { some: { id: c } } }, order: 1 } })).id, channel: "email", status: "scheduled", scheduledAt: new Date("2026-01-01") } });
    const ok = await sendEmail(t2.id, { now: NOW, transport });
    expect(ok.status).toBe("sent");
  }, 60000);

  it("seed nunca é ativado (startSequence / startCampaignSequences / autoStart)", async () => {
    const c = await mkCampaign(["email"], { autoStart: true });
    const s = await mkLead(c, { source: "seed" });
    const r1 = await startSequence({ leadId: s.id });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.errors.leadId[0]).toMatch(/seed/);
    const r2 = await startCampaignSequences({ campaignId: c, confirm: true });
    expect(r2.ok && r2.data).toMatchObject({ started: 0, ineligible: { seed: 1 } });
    const t = await tick(c);
    expect(t.counters.auto_started ?? 0).toBe(0);
    expect((await getLead(s.id)).sequenceStatus).toBe("not_started");
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe("início explícito", () => {
  it("not_started NÃO dispara sozinho (autoStart=false), nem depois de várias rodadas", async () => {
    const c = await mkCampaign(["email"]);
    const l = await mkLead(c);
    await tick(c);
    await tick(c, new Date(NOW.getTime() + 3 * 24 * 3600_000));
    expect(await touches(l.id)).toHaveLength(0);
    expect((await getLead(l.id)).sequenceStatus).toBe("not_started");
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("autoStart=true: fase 0 ativa e dispara só elegíveis; suprimido/opt-out/sem contato/pausada ficam de fora; rodada idempotente", async () => {
    const c = await mkCampaign(["email"], { autoStart: true });
    const ok = await mkLead(c);
    const sup = await mkLead(c, { email: `sup@${TAG}.com` });
    await prisma.suppression.create({ data: { kind: "email", value: `sup@${TAG}.com`, reason: "bounce" } });
    const optOut = await mkLead(c, { optedOutAt: NOW });
    const noMail = await mkLead(c, { email: null });
    const replied = await mkLead(c, { repliedAt: NOW });
    const r = await tick(c);
    expect(r.counters.auto_started).toBe(1);
    expect(r.counters.result_sent).toBe(1);
    expect(await getLead(ok.id)).toMatchObject({ sequenceStatus: "completed" }); // 1 step
    expect((await touches(ok.id))[0].status).toBe("sent");
    for (const l of [sup, optOut, noMail, replied]) {
      expect(await touches(l.id)).toHaveLength(0);
      expect((await getLead(l.id)).sequenceStatus).toBe("not_started");
    }
    const r2 = await tick(c);
    expect(r2.counters.auto_started ?? 0).toBe(0);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("autoStart=true em campanha pausada não inicia nada", async () => {
    const c = await mkCampaign(["email"], { autoStart: true, status: "paused" });
    const l = await mkLead(c);
    await tick(c);
    expect((await getLead(l.id)).sequenceStatus).toBe("not_started");
  });

  it("startSequence: valida e é idempotente; define active/nextTouchAt; exige campanha ativa e sequência", async () => {
    const c = await mkCampaign(["email"]);
    const l = await mkLead(c);
    expect((await startSequence({ leadId: "x" })).ok).toBe(false);
    const r = await startSequence({ leadId: l.id });
    expect(r).toMatchObject({ ok: true, data: { started: true } });
    const after = await getLead(l.id);
    expect(after.sequenceStatus).toBe("active");
    expect(after.nextTouchAt).not.toBeNull();
    expect(await startSequence({ leadId: l.id })).toMatchObject({ ok: true, data: { started: false } });
    expect(sendMail).not.toHaveBeenCalled(); // a action não envia; o tick envia
    await tick(c, new Date(Date.now() + 1000));

    const paused = await mkCampaign(["email"], { status: "paused" });
    const p = await mkLead(paused);
    const rp = await startSequence({ leadId: p.id });
    expect(!rp.ok && rp.errors.leadId[0]).toMatch(/não está ativa/);
    const noSeq = await prisma.campaign.create({ data: { name: `${TAG}-noseq`, userId, icpId } });
    const ns = await mkLead(noSeq.id);
    const rn = await startSequence({ leadId: ns.id });
    expect(!rn.ok && rn.errors.leadId[0]).toMatch(/sem sequência/);
    // contato incompatível com o 1º canal (whatsapp sem telefone)
    const cw = await mkCampaign(["whatsapp"]);
    const nophone = await mkLead(cw, { phone: null });
    expect((await startSequence({ leadId: nophone.id })).ok).toBe(false);
    // suprimido
    const sup = await mkLead(c, { email: `sup2@${TAG}.com` });
    await prisma.suppression.create({ data: { kind: "email", value: `sup2@${TAG}.com`, reason: "manual" } });
    const rs = await startSequence({ leadId: sup.id });
    expect(!rs.ok && rs.errors.leadId[0]).toMatch(/supressão/);
    expect((await getLead(sup.id)).sequenceStatus).toBe("not_started");
  }, 60000);

  it("startCampaignSequences: confirm obrigatório; inicia todos elegíveis; retorna razões; idempotente; countStartableLeads", async () => {
    const c = await mkCampaign(["email"]);
    const a = await mkLead(c);
    const b = await mkLead(c);
    const seedL = await mkLead(c, { source: "seed" });
    const noMail = await mkLead(c, { email: null });
    expect((await startCampaignSequences({ campaignId: c })).ok).toBe(false);
    expect((await startCampaignSequences({ campaignId: c, confirm: false })).ok).toBe(false);
    expect((await getLead(a.id)).sequenceStatus).toBe("not_started");

    const count = await countStartableLeads(c);
    expect(count).toMatchObject({ eligible: 2, ineligible: 2, campaignActive: true, hasSequence: true, autoStart: false });
    expect(count!.ineligibleByReason.map((x) => x.reason).sort()).toEqual(["no_contact", "seed"]);

    const r = await startCampaignSequences({ campaignId: c, confirm: true });
    expect(r.ok && r.data).toMatchObject({ started: 2, ineligibleTotal: 2, ineligible: { seed: 1, no_contact: 1 } });
    expect((await getLead(a.id)).sequenceStatus).toBe("active");
    expect((await getLead(b.id)).sequenceStatus).toBe("active");
    expect((await getLead(seedL.id)).sequenceStatus).toBe("not_started");
    expect((await getLead(noMail.id)).sequenceStatus).toBe("not_started");
    const again = await startCampaignSequences({ campaignId: c, confirm: true });
    expect(again.ok && again.data.started).toBe(0);
    expect(sendMail).not.toHaveBeenCalled();

    const paused = await mkCampaign(["email"], { status: "paused" });
    await mkLead(paused);
    expect((await startCampaignSequences({ campaignId: paused, confirm: true })).ok).toBe(false);
  }, 60000);

  it("stopSequence: paused_manual, cancela touches scheduled/pending, idempotente, não dispara; startSequence reinicia", async () => {
    const c = await mkCampaign(["email", "email"]);
    const l = await mkLead(c, { sequenceStatus: "active", nextTouchAt: new Date("2026-01-01") });
    const step = await prisma.sequenceStep.findFirstOrThrow({ where: { sequence: { campaigns: { some: { id: c } } }, order: 1 } });
    const t = await prisma.touch.create({ data: { leadId: l.id, stepId: step.id, channel: "email", status: "scheduled", scheduledAt: new Date("2026-01-01") } });
    const r = await stopSequence({ leadId: l.id });
    expect(r).toMatchObject({ ok: true, data: { stopped: true, cancelledTouches: 1 } });
    expect(await getLead(l.id)).toMatchObject({ sequenceStatus: "paused_manual", nextTouchAt: null });
    expect(await prisma.touch.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ status: "skipped", error: "sequência parada manualmente" });
    expect(await stopSequence({ leadId: l.id })).toMatchObject({ ok: true, data: { stopped: false } });
    await tick(c, new Date(Date.now() + 1000));
    expect(sendMail).not.toHaveBeenCalled();
    // não ativo -> erro
    const ns = await mkLead(c);
    expect((await stopSequence({ leadId: ns.id })).ok).toBe(false);
    // reinício
    expect(await startSequence({ leadId: l.id })).toMatchObject({ ok: true, data: { started: true } });
    expect((await getLead(l.id)).sequenceStatus).toBe("active");
    // canal também barra Touch de lead paused_manual
    await stopSequence({ leadId: l.id });
    const t2 = await prisma.touch.create({ data: { leadId: l.id, stepId: step.id === t.stepId ? (await prisma.sequenceStep.findFirstOrThrow({ where: { sequence: { campaigns: { some: { id: c } } }, order: 2 } })).id : step.id, channel: "email", status: "scheduled", scheduledAt: NOW } });
    expect((await sendEmail(t2.id, { now: NOW, transport })).status).toBe("skipped");
    expect(sendMail).not.toHaveBeenCalled();
  }, 60000);

  it("M2: reinício reabre o step interrompido e re-ancora o espaçamento (não vencem todos de uma vez)", async () => {
    const c = await mkCampaign(["email", "email", "email"]); // dias 0, 1, 2
    const steps = await prisma.sequenceStep.findMany({ where: { sequence: { campaigns: { some: { id: c } } } }, orderBy: { order: "asc" } });
    const l = await mkLead(c, { sequenceStatus: "active", nextTouchAt: NOW, currentStepOrder: 1, sequenceStartedAt: NOW });
    const t = await prisma.touch.create({ data: { leadId: l.id, stepId: steps[1].id, channel: "email", status: "scheduled", scheduledAt: NOW } });
    expect(await stopSequence({ leadId: l.id })).toMatchObject({ ok: true, data: { stopped: true, cancelledTouches: 1 } });
    expect((await prisma.touch.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("skipped");

    const RESTART = new Date(NOW.getTime() + 7 * DAY_MS); // segunda 10:30 SP (dentro da janela)
    expect(await activateLeads([l.id], RESTART)).toBe(1);
    const re = await getLead(l.id);
    expect(re).toMatchObject({ sequenceStatus: "active", currentStepOrder: 1 });
    expect(re.nextTouchAt!.getTime()).toBe(RESTART.getTime());
    expect(re.sequenceStartedAt!.getTime()).toBe(RESTART.getTime() - 1 * DAY_MS); // now - day(step atual)
    expect(await prisma.touch.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ status: "scheduled", error: null }); // mesmo registro reaberto

    const r1 = await tick(c, RESTART);
    expect(r1.counters.result_sent).toBe(1);
    expect(sendMail).toHaveBeenCalledTimes(1); // envia o step 2 (interrompido)
    const after = await getLead(l.id);
    expect(after.currentStepOrder).toBe(2);
    expect(after.nextTouchAt!.getTime()).toBe(RESTART.getTime() + 1 * DAY_MS); // espaçamento relativo (day 2 - day 1)
    const r2 = await tick(c, RESTART); // ainda não venceu o seguinte
    expect(r2.counters.result_sent ?? 0).toBe(0);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const r3 = await tick(c, new Date(RESTART.getTime() + DAY_MS));
    expect(r3.counters.result_sent).toBe(1);
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(await touches(l.id)).toHaveLength(2); // unique leadId+stepId: nada duplicado
  }, 60000);

  it("M2: só reabre skipped por parada manual; skipped por regra (suprimido/limite) permanece skipped", async () => {
    const c = await mkCampaign(["email", "email"]);
    const steps = await prisma.sequenceStep.findMany({ where: { sequence: { campaigns: { some: { id: c } } } }, orderBy: { order: "asc" } });
    const l = await mkLead(c, { sequenceStatus: "paused_manual", nextTouchAt: null, currentStepOrder: 1, sequenceStartedAt: NOW });
    const t = await prisma.touch.create({ data: { leadId: l.id, stepId: steps[1].id, channel: "email", status: "skipped", error: "limite de toques", scheduledAt: NOW } });
    expect(await activateLeads([l.id], NOW)).toBe(1);
    expect((await prisma.touch.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("skipped");
    // lead not_started (nunca iniciado) não ganha sequenceStartedAt
    const ns = await mkLead(c);
    expect(await activateLeads([ns.id], NOW)).toBe(1);
    expect((await getLead(ns.id)).sequenceStartedAt).toBeNull();
  });

  it("auditoria de início/parada sem PII", async () => {
    const c = await mkCampaign(["email"]);
    const l = await mkLead(c, { email: `pii@${TAG}.com` });
    await startSequence({ leadId: l.id });
    await stopSequence({ leadId: l.id });
    const evs = await prisma.webhookEvent.findMany({ where: { source: "sequence_audit", payload: { path: ["campaignId"], equals: c } } });
    expect(evs.map((e) => (e.payload as { action: string }).action).sort()).toEqual(["start_sequence", "stop_sequence"]);
    const blob = JSON.stringify(evs);
    expect(blob).not.toContain(`pii@${TAG}.com`);
    expect(blob).not.toContain(l.phone!);
    await prisma.webhookEvent.deleteMany({ where: { id: { in: evs.map((e) => e.id) } } });
  });
});
