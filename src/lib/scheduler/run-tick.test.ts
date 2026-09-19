import "dotenv/config";
import { randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.AUTH_URL = "http://app.test";

import { prisma } from "@/lib/prisma";
import { seed } from "../../../prisma/seed";
import { encrypt } from "@/lib/crypto/secret-box";
import { AppError } from "@/lib/errors";
import { sendEmail } from "@/lib/channels/email";
import { sendWhatsApp } from "@/lib/channels/whatsapp";
import { FakeWhatsAppProvider } from "@/lib/whatsapp/providers/fake";
import { runTick, type TickDeps } from "./run-tick";
import { DAY_MS } from "./decide";
import { getSchedulerConfig } from "./config";
import { SENDING_STALE_MS } from "@/lib/channels/email";
import { NEEDS_REVIEW_PREFIX } from "@/lib/channels/reserve";
import type { Channel, Stage } from "@prisma/client";

const TAG = "zz-test-spec013";
const START = new Date("2026-06-08T13:30:00Z"); // segunda, SP 10:30 (janela 9-12)
const day = (n: number, base = START) => new Date(base.getTime() + n * DAY_MS);
const json = () => nodemailer.createTransport({ jsonTransport: true });

let userId = "";
let icpId = "";
let n = 0;
const camps: string[] = [];
const seqs: string[] = [];
const insts: string[] = [];
let fake = new FakeWhatsAppProvider();

interface Fx { campId: string; instId: string; stepIds: string[] }
async function mkCampaign(steps: { day: number; channel: Channel }[], over: Record<string, unknown> = {}): Promise<Fx> {
  n++;
  const name = `${TAG}-${n}`;
  const seq = await prisma.sequence.create({ data: { name } });
  seqs.push(seq.id);
  const inst = await prisma.whatsAppInstance.create({
    data: { instanceName: name, number: "+5511999990000", webhookToken: `${name}-${Date.now()}-${Math.random()}`, status: "connected", warmupStartedAt: new Date("2026-01-01T00:00:00Z") },
  });
  insts.push(inst.id);
  const camp = await prisma.campaign.create({ data: { name, userId, icpId, sequenceId: seq.id, whatsappInstanceId: inst.id, ...over } });
  camps.push(camp.id);
  const tpl = await prisma.messageTemplate.create({ data: { campaignId: camp.id, channel: "email", name, subject: "Oi {{firstName}}", body: "Olá {{firstName}} da {{company}}" } });
  const stepIds: string[] = [];
  for (const [i, s] of steps.entries()) {
    stepIds.push((await prisma.sequenceStep.create({ data: { sequenceId: seq.id, day: s.day, channel: s.channel, templateId: tpl.id, order: i + 1 } })).id);
  }
  return { campId: camp.id, instId: inst.id, stepIds };
}
async function mkLead(fx: Fx, over: Record<string, unknown> = {}, stage: Stage = "novo_lead") {
  n++;
  const lead = await prisma.lead.create({
    data: { campaignId: fx.campId, name: `Ana ${n}`, company: "Acme", email: `l${n}@${TAG}.com`, phone: `+5511${String(900000000 + n * 13 + (Date.now() % 100000))}`, hasWhatsapp: true, sequenceStatus: "active", nextTouchAt: new Date("2026-01-01T00:00:00Z"), ...over },
  });
  const opp = await prisma.opportunity.create({ data: { leadId: lead.id, campaignId: fx.campId, stage } });
  return { ...lead, oppId: opp.id };
}
const getLead = (id: string) => prisma.lead.findUniqueOrThrow({ where: { id } });
const touches = (leadId: string) => prisma.touch.findMany({ where: { leadId }, orderBy: { createdAt: "asc" } });

/** Deps de teste: provider/transport FAKES, saúde no-op, isolado na campanha. */
function deps(fx: Fx | Fx[], over: Partial<TickDeps> = {}): Partial<TickDeps> {
  const ids = (Array.isArray(fx) ? fx : [fx]).map((f) => f.campId);
  return {
    campaignIds: ids,
    sendWhatsApp: (id, now) => sendWhatsApp(id, { now, provider: fake, rng: () => 0 }),
    sendEmail: (id, now) => sendEmail(id, { now, transport: json() }),
    evaluateHealth: async () => 0,
    ...over,
  };
}
const tick = (now: Date, fx: Fx | Fx[], over: Partial<TickDeps> = {}) => runTick(now, deps(fx, over));

beforeAll(async () => {
  await seed(prisma);
  await cleanup();
  userId = (await prisma.user.findFirstOrThrow({ where: { email: "admin@leadforge.local" } })).id;
  icpId = (await prisma.icpProfile.findFirstOrThrow()).id;
  await prisma.emailAccount.create({ data: { userId, provider: "smtp", smtpHost: "smtp.interno.local", email: `a@${TAG}.com`, encryptedPassword: encrypt("x"), dailyLimit: 1000 } });
}, 30000);

async function cleanup() {
  const cs = await prisma.campaign.findMany({ where: { name: { startsWith: TAG } }, select: { id: true, sequenceId: true } });
  const ids = cs.map((c) => c.id);
  await prisma.suppression.deleteMany({ where: { value: { contains: TAG } } });
  await prisma.lead.deleteMany({ where: { campaignId: { in: ids } } });
  await prisma.emailAccount.deleteMany({ where: { email: { contains: TAG } } });
  await prisma.sequenceStep.deleteMany({ where: { sequence: { name: { startsWith: TAG } } } });
  await prisma.campaign.deleteMany({ where: { id: { in: ids } } });
  await prisma.sequence.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.whatsAppInstance.deleteMany({ where: { instanceName: { startsWith: TAG } } });
  await prisma.schedulerRun.deleteMany({ where: { startedAt: { gte: new Date("2026-06-01T00:00:00Z"), lt: new Date("2026-07-01T00:00:00Z") } } });
}

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("cadência completa (canais reais + provider/transport fakes)", () => {
  it("dia 0, dia N só quando chega, 3 WhatsApp/14 dias, stage forward-only, fim -> completed, idempotente", async () => {
    fake = new FakeWhatsAppProvider();
    const fx = await mkCampaign([
      { day: 0, channel: "whatsapp" }, { day: 2, channel: "email" }, { day: 4, channel: "whatsapp" },
      { day: 7, channel: "email" }, { day: 10, channel: "whatsapp" }, { day: 12, channel: "whatsapp" },
    ]);
    const lead = await mkLead(fx);

    const r0 = await tick(START, fx);
    expect(r0.status).toBe("ok");
    expect(fake.sent).toHaveLength(1);
    let l = await getLead(lead.id);
    expect(l).toMatchObject({ sequenceStatus: "active", currentStepOrder: 1 });
    expect(l.sequenceStartedAt).toEqual(START);
    expect(l.nextTouchAt).toEqual(day(2));
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: lead.oppId } })).stage).toBe("contactado");

    // idempotente: 2ª rodada no MESMO instante não reenvia nem reprocessa
    await tick(START, fx);
    expect(fake.sent).toHaveLength(1);
    expect(await touches(lead.id)).toHaveLength(1);
    // dia 1: nada
    await tick(day(1), fx);
    expect(await touches(lead.id)).toHaveLength(1);

    await tick(day(2), fx); // email
    expect((await touches(lead.id)).map((t) => [t.channel, t.status])).toEqual([["whatsapp", "sent"], ["email", "sent"]]);
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: lead.oppId } })).stage).toBe("em_followup");
    await tick(day(4), fx); // WA 2
    await tick(day(7), fx); // email
    await tick(day(10), fx); // WA 3
    expect(fake.sent).toHaveLength(3);
    l = await getLead(lead.id);
    expect(l).toMatchObject({ sequenceStatus: "active", currentStepOrder: 5 });

    await tick(day(12), fx); // WA 4 -> limite de 3 toques/14 dias: skipped, fim da sequência
    expect(fake.sent).toHaveLength(3);
    l = await getLead(lead.id);
    expect(l).toMatchObject({ sequenceStatus: "completed", currentStepOrder: 6, nextTouchAt: null });
    const all = await touches(lead.id);
    expect(all).toHaveLength(6);
    expect(all[5]).toMatchObject({ status: "skipped", error: "limite de toques" });
    // depois de completed nada dispara
    await tick(day(30), fx);
    expect(await touches(lead.id)).toHaveLength(6);
  }, 60000);
});

describe("quem não dispara", () => {
  it("paused_replied, optado (status e data), respondeu, suprimido e campanha pausada não disparam", async () => {
    fake = new FakeWhatsAppProvider();
    const fx = await mkCampaign([{ day: 0, channel: "email" }]);
    const due = { sequenceStatus: "active" as const, nextTouchAt: new Date(START.getTime() - 1000) };
    const a = await mkLead(fx, { ...due, sequenceStatus: "paused_replied" });
    const b = await mkLead(fx, { ...due, sequenceStatus: "opted_out" });
    const c = await mkLead(fx, { ...due, optedOutAt: START });
    const d = await mkLead(fx, { ...due, repliedAt: START });
    const e = await mkLead(fx, { ...due, email: `sup@${TAG}.com` });
    await prisma.suppression.create({ data: { kind: "email", value: `sup@${TAG}.com`, reason: "bounce" } });
    const r = await tick(START, fx);
    for (const l of [a, b, c, d]) expect(await touches(l.id)).toHaveLength(0);
    expect(await touches(e.id)).toHaveLength(0);
    expect(r.counters.suppressed_closed).toBe(1);
    expect((await getLead(e.id)).sequenceStatus).toBe("completed"); // bounce != opt-out
    expect(r.counters.processed_b ?? 0).toBe(0);

    const paused = await mkCampaign([{ day: 0, channel: "email" }], { status: "paused" });
    const p = await mkLead(paused, { sequenceStatus: "not_started", nextTouchAt: null });
    await prisma.touch.create({ data: { leadId: p.id, stepId: paused.stepIds[0], channel: "email", status: "scheduled", scheduledAt: START } });
    await tick(START, paused);
    expect((await touches(p.id))[0].status).toBe("scheduled");
    expect((await getLead(p.id)).sequenceStatus).toBe("not_started");
  });

  it("supressão por opt-out (via Fila A, canal real) encerra como opted_out", async () => {
    fake = new FakeWhatsAppProvider();
    const fx = await mkCampaign([{ day: 0, channel: "email" }, { day: 1, channel: "email" }]);
    const l = await mkLead(fx, { sequenceStatus: "active", email: `optout@${TAG}.com` });
    await prisma.suppression.create({ data: { kind: "email", value: `optout@${TAG}.com`, reason: "opt_out_link" } });
    const t = await prisma.touch.create({ data: { leadId: l.id, stepId: fx.stepIds[0], channel: "email", status: "scheduled", scheduledAt: START } });
    await tick(START, fx);
    expect((await prisma.touch.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("skipped");
    expect((await getLead(l.id)).sequenceStatus).toBe("opted_out");
  });
});

describe("lock global", () => {
  it("duas rodadas simultâneas: uma envia, a outra locked; nenhum envio duplicado", async () => {
    fake = new FakeWhatsAppProvider();
    const fx = await mkCampaign([{ day: 0, channel: "whatsapp" }]);
    const lead = await mkLead(fx);
    const slow: Partial<TickDeps> = {
      sendWhatsApp: async (id, now) => {
        await new Promise((r) => setTimeout(r, 400));
        return sendWhatsApp(id, { now, provider: fake, rng: () => 0 });
      },
    };
    const [a, b] = await Promise.all([tick(START, fx, slow), tick(START, fx, slow)]);
    expect([a.status, b.status].sort()).toEqual(["locked", "ok"]);
    expect([a, b].find((x) => x.status === "locked")).toMatchObject({ skipped: "locked" });
    expect(fake.sent).toHaveLength(1);
    expect((await touches(lead.id)).filter((t) => t.status === "sent")).toHaveLength(1);
  });

  it("lock é liberado mesmo se a rodada falha no meio (finally)", async () => {
    const fx = await mkCampaign([{ day: 0, channel: "email" }]);
    await mkLead(fx);
    let calls = 0;
    const r = await tick(START, fx, { clock: () => { if (++calls === 2) throw new Error("boom secreto=abc"); return 0; } });
    expect(r.status).toBe("error");
    expect(r.error).toBeTruthy();
    const after = await tick(START, fx);
    expect(after.status).toBe("ok"); // não ficou locked
  });

  it("falha ao adquirir o lock devolve error sem lançar", async () => {
    const r = await runTick(START, { acquireLock: async () => { throw new Error("db down"); } });
    expect(r.status).toBe("error");
  });
});

describe("resultados dos canais", () => {
  const stubTouch = async (id: string, data: Record<string, unknown>) => void (await prisma.touch.update({ where: { id }, data }));

  it("deferred real (fora da janela): fica scheduled no instante da janela, sem laço, e retoma no instante certo", async () => {
    fake = new FakeWhatsAppProvider();
    const fx = await mkCampaign([{ day: 0, channel: "whatsapp" }, { day: 3, channel: "email" }]);
    const lead = await mkLead(fx);
    const sat = new Date("2026-06-13T15:00:00Z"); // sábado
    const r1 = await tick(sat, fx);
    expect(r1.counters.deferred_outside_window).toBe(1);
    const t = (await touches(lead.id))[0];
    expect(t.status).toBe("scheduled");
    expect(t.scheduledAt!.getTime()).toBeGreaterThan(sat.getTime());
    expect((await getLead(lead.id)).currentStepOrder).toBe(0);
    // mesma instante: não reprocessa
    const r2 = await tick(sat, fx);
    expect(r2.counters.processed_a ?? 0).toBe(0);
    expect(r2.counters.processed_b ?? 0).toBe(0);
    expect(fake.sent).toHaveLength(0);
    // no instante devolvido pelo canal: envia
    await tick(t.scheduledAt!, fx);
    expect(fake.sent).toHaveLength(1);
    expect((await getLead(lead.id)).currentStepOrder).toBe(1);
  });

  it("deferred com instante <= agora é empurrado (nunca no mesmo instante)", async () => {
    const fx = await mkCampaign([{ day: 0, channel: "email" }]);
    const lead = await mkLead(fx);
    let calls = 0;
    const stub: Partial<TickDeps> = {
      sendEmail: async (id, now) => { calls++; await stubTouch(id, { status: "scheduled", scheduledAt: now }); return { status: "deferred", nextAt: now }; },
    };
    await tick(START, fx, stub);
    await tick(START, fx, stub);
    expect(calls).toBe(1);
    expect((await touches(lead.id))[0].scheduledAt!.getTime()).toBeGreaterThan(START.getTime());
  });

  it("skipped por motivo: replied -> paused_replied; opted_out -> opted_out; sequence_completed -> completed", async () => {
    for (const [reason, status] of [["replied", "paused_replied"], ["opted_out", "opted_out"], ["sequence_completed", "completed"]] as const) {
      const fx = await mkCampaign([{ day: 0, channel: "email" }, { day: 1, channel: "email" }]);
      const lead = await mkLead(fx);
      await tick(START, fx, { sendEmail: async (id) => { await stubTouch(id, { status: "skipped" }); return { status: "skipped", reason }; } });
      expect(await getLead(lead.id)).toMatchObject({ sequenceStatus: status, nextTouchAt: null });
    }
  });

  it("número sem WhatsApp: skipped e fallback para o próximo step (sem enviar)", async () => {
    fake = new FakeWhatsAppProvider();
    const fx = await mkCampaign([{ day: 0, channel: "whatsapp" }, { day: 2, channel: "email" }]);
    const lead = await mkLead(fx, { hasWhatsapp: null });
    fake.noWhatsapp.add(lead.phone!.replace("+", ""));
    fake.noWhatsapp.add(lead.phone!);
    const r = await tick(START, fx);
    expect(r.counters.skipped_no_whatsapp).toBe(1);
    expect(fake.sent).toHaveLength(0);
    const l = await getLead(lead.id);
    expect(l).toMatchObject({ currentStepOrder: 1, sequenceStatus: "active" });
    expect(l.nextTouchAt).toEqual(day(2));
    await tick(day(2), fx);
    expect((await touches(lead.id)).map((t) => [t.channel, t.status])).toEqual([["whatsapp", "skipped"], ["email", "sent"]]);
  });

  it("failed: retry N=3 com backoff 30 min/2 h/6 h; esgotado avança e não trava a sequência", async () => {
    const fx = await mkCampaign([{ day: 0, channel: "email" }, { day: 1, channel: "email" }]);
    const lead = await mkLead(fx);
    const fail = async (id: string): Promise<{ status: "failed"; error: AppError }> => {
      await stubTouch(id, { status: "failed", error: "SMTP indisponível" });
      return { status: "failed", error: new AppError({ code: "upstream", userMessage: "SMTP indisponível" }) };
    };
    const waits = [30 * 60_000, 2 * 3600_000, 6 * 3600_000];
    let now = START;
    for (let i = 0; i < 3; i++) {
      await tick(now, fx, { sendEmail: fail });
      const t = (await touches(lead.id))[0];
      expect(t).toMatchObject({ status: "scheduled", attempts: i + 1 });
      expect(t.scheduledAt).toEqual(new Date(now.getTime() + waits[i]));
      expect((await getLead(lead.id)).currentStepOrder).toBe(0);
      // antes do backoff: não reprocessa
      const early = await tick(new Date(now.getTime() + waits[i] - 1000), fx, { sendEmail: fail });
      expect(early.counters.processed_a ?? 0).toBe(0);
      now = new Date(now.getTime() + waits[i]);
    }
    const r = await tick(now, fx, { sendEmail: fail });
    expect(r.counters.failed_final).toBe(1);
    expect((await touches(lead.id))[0]).toMatchObject({ status: "failed", attempts: 4 });
    expect((await getLead(lead.id)).currentStepOrder).toBe(1);
  });

  it("failed real e depois sucesso no retry (canal reservável a partir de scheduled)", async () => {
    fake = new FakeWhatsAppProvider();
    const fx = await mkCampaign([{ day: 0, channel: "whatsapp" }]);
    const lead = await mkLead(fx);
    fake.sendError = new AppError({ code: "upstream", userMessage: "Provider fora", retryable: true });
    await tick(START, fx);
    const t1 = (await touches(lead.id))[0];
    expect(t1).toMatchObject({ status: "scheduled", attempts: 1 });
    fake.sendError = null;
    const at = new Date(START.getTime() + 30 * 60_000);
    await tick(at, fx);
    expect((await touches(lead.id))[0]).toMatchObject({ status: "sent", error: null });
    expect(fake.sent).toHaveLength(1);
    expect((await getLead(lead.id)).sequenceStatus).toBe("completed");
  });

  it("timeout com aviso NÃO reenvia (exige retryTouch humano) e avança", async () => {
    fake = new FakeWhatsAppProvider();
    const fx = await mkCampaign([{ day: 0, channel: "whatsapp" }, { day: 1, channel: "email" }]);
    const lead = await mkLead(fx);
    fake.sendError = new AppError({ code: "timeout", userMessage: "timeout", retryable: true });
    const r = await tick(START, fx);
    expect(r.counters.timeout_no_retry).toBe(1);
    const t = (await touches(lead.id))[0];
    expect(t.status).toBe("failed");
    expect(t.error).toMatch(/verifique no WhatsApp antes de reenviar/);
    expect((await getLead(lead.id)).currentStepOrder).toBe(1);
    fake.sendError = null;
    await tick(day(0.5), fx);
    expect(fake.sent).toHaveLength(0); // nunca reenviado automaticamente
  });

  it("stage forward-only: interessado/fechado/perdido não são alterados; novo_lead -> contactado", async () => {
    const fx = await mkCampaign([{ day: 0, channel: "email" }]);
    const ls = { novo: await mkLead(fx, {}, "novo_lead"), inte: await mkLead(fx, {}, "interessado"), fech: await mkLead(fx, {}, "fechado"), perd: await mkLead(fx, {}, "perdido") };
    await tick(START, fx);
    const stage = async (l: { oppId: string }) => (await prisma.opportunity.findUniqueOrThrow({ where: { id: l.oppId } })).stage;
    expect(await stage(ls.novo)).toBe("contactado");
    expect(await stage(ls.inte)).toBe("interessado");
    // fechado/perdido: o move/end de sequência do pipeline os encerra; aqui só garantimos que o scheduler não regride/sobrescreve
    expect(["fechado"]).toContain(await stage(ls.fech));
    expect(["perdido"]).toContain(await stage(ls.perd));
  });

  it("step de canal manual (linkedin) é pulado sem envio e a sequência segue", async () => {
    const fx = await mkCampaign([{ day: 0, channel: "linkedin" }, { day: 1, channel: "email" }]);
    const lead = await mkLead(fx);
    await tick(START, fx);
    expect((await touches(lead.id))[0]).toMatchObject({ channel: "linkedin", status: "skipped" });
    expect(await getLead(lead.id)).toMatchObject({ currentStepOrder: 1, sequenceStatus: "active" });
  });

  it("campanha sem steps -> lead completed", async () => {
    const fx = await mkCampaign([]);
    const lead = await mkLead(fx);
    await tick(START, fx);
    expect((await getLead(lead.id)).sequenceStatus).toBe("completed");
  });
});

describe("orçamento e serialização", () => {
  it("teto de envios por rodada: para de forma limpa e a próxima rodada continua", async () => {
    const fx = await mkCampaign([{ day: 0, channel: "email" }]);
    const ls = [];
    for (let i = 0; i < 5; i++) ls.push(await mkLead(fx));
    const cfg = { timeBudgetMs: 50_000, maxSends: 2 };
    const r1 = await tick(START, fx, { config: cfg });
    expect(r1.budget).toBe("sends");
    expect(r1.counters.result_sent).toBe(2);
    await tick(START, fx, { config: cfg });
    await tick(START, fx, { config: cfg });
    expect(await prisma.touch.count({ where: { leadId: { in: ls.map((l) => l.id) }, status: "sent" } })).toBe(5);
  });

  it("orçamento de tempo (relógio injetado)", async () => {
    const fx = await mkCampaign([{ day: 0, channel: "email" }]);
    for (let i = 0; i < 4; i++) await mkLead(fx);
    let t = 0;
    const r = await tick(START, fx, { clock: () => (t += 30_000), config: { timeBudgetMs: 50_000, maxSends: 20 } });
    expect(r.budget).toBe("time");
    expect(r.counters.result_sent ?? 0).toBeLessThan(4);
  });

  it("máx. 1 WhatsApp por instância por rodada", async () => {
    fake = new FakeWhatsAppProvider();
    const fx = await mkCampaign([{ day: 0, channel: "whatsapp" }]);
    for (let i = 0; i < 3; i++) await mkLead(fx);
    const r = await tick(START, fx);
    expect(fake.sent).toHaveLength(1);
    expect(r.counters.instance_busy).toBe(2);
    await tick(new Date(START.getTime() + 10 * 60_000), fx);
    expect(fake.sent).toHaveLength(2);
  });
});

describe("orçamento efetivo (M4)", () => {
  it("não INICIA envio quando resta menos que o pior caso: orçamento efetivo default 25 s (relógio injetado)", async () => {
    const fx = await mkCampaign([{ day: 0, channel: "email" }]);
    for (let i = 0; i < 3; i++) await mkLead(fx);
    const config = getSchedulerConfig({});
    let calls = 0;
    // t0 = 0; depois já passaram 26 s (> 25 s): nada pode começar (um envio de pior caso 30 s estouraria maxDuration 60 s).
    const clock = () => (calls++ === 0 ? 0 : 26_000);
    const sendEmailSpy = vi.fn(async () => ({ status: "sent" }) as never);
    const r = await tick(START, fx, { config, clock, sendEmail: sendEmailSpy });
    expect(r.budget).toBe("time");
    expect(sendEmailSpy).not.toHaveBeenCalled();
    // dentro do orçamento (24 s) ainda inicia
    calls = 0;
    const clock2 = () => (calls++ === 0 ? 0 : 24_000);
    const r2 = await tick(START, fx, { config, clock: clock2 });
    expect(r2.counters.result_sent ?? 0).toBeGreaterThan(0);
  });
});

describe("Touch órfão em sending (M3)", () => {
  it("varre sending antigo -> failed(revisão humana), lead avança, nada é enviado, contador e alerta; sending recente NÃO é varrido", async () => {
    const fx = await mkCampaign([{ day: 0, channel: "email" }, { day: 2, channel: "email" }]);
    const old = await mkLead(fx, { nextTouchAt: START, sequenceStartedAt: START });
    const fresh = await mkLead(fx, { nextTouchAt: START, sequenceStartedAt: START });
    const mk = (leadId: string, ageMs: number) =>
      prisma.touch.create({ data: { leadId, stepId: fx.stepIds[0], channel: "email", status: "sending", scheduledAt: START, whatsappInstanceId: fx.instId, updatedAt: new Date(START.getTime() - ageMs) } });
    const tOld = await mk(old.id, SENDING_STALE_MS + 5 * 60_000);
    const tFresh = await mk(fresh.id, 60_000);
    const sendEmailSpy = vi.fn(async () => ({ status: "sent" }) as never);
    const r = await tick(START, fx, { sendEmail: sendEmailSpy });
    expect(r.counters.staleSending).toBe(1);
    expect(sendEmailSpy).not.toHaveBeenCalled(); // nunca reenvia (a mensagem pode ter saído)
    const swept = await prisma.touch.findUniqueOrThrow({ where: { id: tOld.id } });
    expect(swept.status).toBe("failed");
    expect(swept.error!.startsWith(NEEDS_REVIEW_PREFIX)).toBe(true);
    const lead = await getLead(old.id);
    expect(lead.currentStepOrder).toBe(1);
    expect(lead.nextTouchAt!.getTime()).toBe(START.getTime() + 2 * DAY_MS);
    expect((await prisma.touch.findUniqueOrThrow({ where: { id: tFresh.id } })).status).toBe("sending");
    expect((await getLead(fresh.id)).currentStepOrder).toBe(0);
    const run = await prisma.schedulerRun.findUniqueOrThrow({ where: { id: r.runId! } });
    expect(run.counters).toMatchObject({ staleSending: 1 });
    const alerts = await prisma.instanceAlert.findMany({ where: { instanceId: fx.instId } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).not.toMatch(/@|\+55/);
    // rodada seguinte não reprocessa
    const r2 = await tick(START, fx, { sendEmail: sendEmailSpy });
    expect(r2.counters.staleSending ?? 0).toBe(0);
  });
});

describe("SchedulerRun e saúde", () => {
  it("registra a rodada (contadores, sem PII) e falha de saúde não derruba a rodada", async () => {
    const fx = await mkCampaign([{ day: 0, channel: "email" }]);
    const lead = await mkLead(fx);
    const r = await tick(START, fx, { evaluateHealth: async () => { throw new Error("saude falhou"); } });
    expect(r.status).toBe("ok");
    expect(r.counters.health_errors).toBe(1);
    const run = await prisma.schedulerRun.findUniqueOrThrow({ where: { id: r.runId! } });
    expect(run).toMatchObject({ status: "ok", error: null });
    expect(run.finishedAt).not.toBeNull();
    expect(run.counters).toMatchObject({ result_sent: 1 });
    expect(JSON.stringify(run)).not.toContain(lead.email!);
    expect(JSON.stringify(run)).not.toContain(lead.phone!);
  });

  it("evaluateHealth é chamado uma vez por rodada com o `now` injetado", async () => {
    const fx = await mkCampaign([]);
    const health = vi.fn(async () => 0);
    await tick(START, fx, { evaluateHealth: health });
    expect(health).toHaveBeenCalledWith(START);
    expect(health).toHaveBeenCalledTimes(1);
  });
});
