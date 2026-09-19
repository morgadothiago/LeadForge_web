import "dotenv/config";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");

import { prisma } from "@/lib/prisma";
import { seed } from "../../../prisma/seed";
import { AppError } from "@/lib/errors";
import { FakeWhatsAppProvider } from "@/lib/whatsapp/providers/fake";
import { sendWhatsApp, TIMEOUT_WARNING } from "./whatsapp";

const TAG = "zz-test-spec011ch";
const IN_WINDOW = new Date("2026-06-10T13:30:00Z"); // quarta, SP 10:30 (janela 9-12)
let campId = "";
let stepId = "";
let instId = "";
let n = 0;

async function mkLead(over: Record<string, unknown> = {}) {
  n++;
  return prisma.lead.create({ data: { campaignId: campId, name: `Ana ${n}`, company: "Acme", hasWhatsapp: true, phone: `+55119${String(10000000 + n * 7 + Date.now() % 1000000).slice(0, 8)}`, ...over } });
}
const mkTouch = (leadId: string, over: Record<string, unknown> = {}) => prisma.touch.create({ data: { leadId, channel: "whatsapp", stepId, status: "scheduled", ...over } });
const get = (id: string) => prisma.touch.findUniqueOrThrow({ where: { id } });
const setInst = (data: Record<string, unknown>) => prisma.whatsAppInstance.update({ where: { id: instId }, data });
async function reset() {
  await prisma.touch.deleteMany({ where: { lead: { campaignId: campId } } });
  await setInst({ status: "connected", dailyLimit: 30, health: "good", pausedUntil: null, pausedReason: null, healthResetAt: null, warmupStartedAt: new Date("2026-01-01T00:00:00Z") });
}

beforeAll(async () => {
  await seed(prisma);
  const user = await prisma.user.findFirstOrThrow({ where: { email: "admin@leadforge.local" } });
  const icp = await prisma.icpProfile.findFirstOrThrow();
  const seq = await prisma.sequence.create({ data: { name: TAG } });
  instId = (await prisma.whatsAppInstance.create({ data: { instanceName: TAG, number: "+5511999990000", webhookToken: `${TAG}-${Date.now()}-${Math.random()}`, status: "connected" } })).id;
  campId = (await prisma.campaign.create({ data: { name: TAG, userId: user.id, icpId: icp.id, sequenceId: seq.id, whatsappInstanceId: instId } })).id;
  const tpl = await prisma.messageTemplate.create({ data: { campaignId: campId, channel: "whatsapp", name: TAG, body: "Olá {{firstName}} da {{company}}" } });
  stepId = (await prisma.sequenceStep.create({ data: { sequenceId: seq.id, day: 0, channel: "whatsapp", templateId: tpl.id, order: 1 } })).id;
}, 30000);

afterAll(async () => {
  await prisma.lead.deleteMany({ where: { campaignId: campId } });
  await prisma.sequenceStep.deleteMany({ where: { id: stepId } });
  await prisma.campaign.deleteMany({ where: { id: campId } });
  await prisma.messageTemplate.deleteMany({ where: { name: TAG } });
  await prisma.sequence.deleteMany({ where: { name: TAG } });
  await prisma.whatsAppInstance.deleteMany({ where: { instanceName: TAG } });
  await prisma.$disconnect();
});

describe("sendWhatsApp (somente FakeWhatsAppProvider)", () => {
  it("envia, atualiza Touch e é idempotente", async () => {
    await reset();
    const fake = new FakeWhatsAppProvider();
    const lead = await mkLead();
    const t = await mkTouch(lead.id);
    const r = await sendWhatsApp(t.id, { now: IN_WINDOW, provider: fake });
    expect(r.status).toBe("sent");
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]).toMatchObject({ instanceName: TAG, to: lead.phone, text: "Olá Ana da Acme" });
    const db = await get(t.id);
    expect(db).toMatchObject({ status: "sent", externalId: "fake-msg-1", whatsappInstanceId: instId, error: null });
    expect(db.sentAt).toEqual(IN_WINDOW);
    expect((await sendWhatsApp(t.id, { now: IN_WINDOW, provider: fake })).status).toBe("already_sent");
    expect(fake.sent).toHaveLength(1);
  });

  it("fora da janela: não chama API, scheduled com scheduledAt = próximo início de janela (9h) do lead", async () => {
    await reset();
    const fake = new FakeWhatsAppProvider();
    const lead = await mkLead();
    const t = await mkTouch(lead.id);
    const r = await sendWhatsApp(t.id, { now: new Date("2026-06-10T22:00:00Z"), provider: fake }); // SP 19:00
    expect(r).toMatchObject({ status: "deferred", reason: "outside_window" });
    expect(fake.sent).toHaveLength(0);
    const db = await get(t.id);
    expect(db.status).toBe("scheduled");
    expect(db.scheduledAt?.toISOString()).toBe("2026-06-11T12:00:00.000Z"); // quinta 09:00 SP
  });

  it("janela usa o fuso do lead (Tóquio 21:00 = fora)", async () => {
    await reset();
    const fake = new FakeWhatsAppProvider();
    const t = await mkTouch((await mkLead({ timezone: "Asia/Tokyo" })).id);
    expect((await sendWhatsApp(t.id, { now: IN_WINDOW, provider: fake })).status).toBe("deferred");
    expect(fake.sent).toHaveLength(0);
  });

  it("optout/completed -> skipped; sem telefone válido -> failed sem enviar", async () => {
    await reset();
    const fake = new FakeWhatsAppProvider();
    const a = await mkTouch((await mkLead({ optedOutAt: new Date() })).id);
    expect(await sendWhatsApp(a.id, { now: IN_WINDOW, provider: fake })).toMatchObject({ status: "skipped", reason: "opted_out" });
    const b = await mkTouch((await mkLead({ sequenceStatus: "completed" })).id);
    expect(await sendWhatsApp(b.id, { now: IN_WINDOW, provider: fake })).toMatchObject({ status: "skipped", reason: "sequence_completed" });
    for (const phone of [null, "1133334444"]) {
      const t = await mkTouch((await mkLead({ phone })).id);
      expect((await sendWhatsApp(t.id, { now: IN_WINDOW, provider: fake })).status).toBe("failed");
      expect((await get(t.id)).error).toMatch(/telefone válido/);
    }
    expect(fake.sent).toHaveLength(0);
  });

  it("variável desconhecida -> failed", async () => {
    await reset();
    const tpl = await prisma.messageTemplate.create({ data: { campaignId: campId, channel: "whatsapp", name: TAG, body: "Oi {{xyz}}" } });
    const step = await prisma.sequenceStep.create({ data: { sequenceId: (await prisma.campaign.findUniqueOrThrow({ where: { id: campId } })).sequenceId!, day: 1, channel: "whatsapp", templateId: tpl.id, order: 2 } });
    const t = await mkTouch((await mkLead()).id, { stepId: step.id });
    const fake = new FakeWhatsAppProvider();
    expect((await sendWhatsApp(t.id, { now: IN_WINDOW, provider: fake })).status).toBe("failed");
    expect((await get(t.id)).error).toMatch(/\{\{xyz\}\}/);
    expect(fake.sent).toHaveLength(0);
    await prisma.touch.deleteMany({ where: { stepId: step.id } });
    await prisma.sequenceStep.delete({ where: { id: step.id } });
  });

  it("instância desconectada -> deferred com erro claro", async () => {
    await reset();
    await setInst({ status: "disconnected" });
    const fake = new FakeWhatsAppProvider();
    const t = await mkTouch((await mkLead()).id);
    expect(await sendWhatsApp(t.id, { now: IN_WINDOW, provider: fake })).toMatchObject({ status: "deferred", reason: "not_connected" });
    const db = await get(t.id);
    expect(db.status).toBe("scheduled");
    expect(db.error).toMatch(/desconectada/);
    expect(fake.sent).toHaveLength(0);
  });

  it("campanha sem instância -> failed", async () => {
    await reset();
    const lead = await mkLead();
    await prisma.campaign.update({ where: { id: campId }, data: { whatsappInstanceId: null } });
    const t = await mkTouch(lead.id);
    expect((await sendWhatsApp(t.id, { now: IN_WINDOW, provider: new FakeWhatsAppProvider() })).status).toBe("failed");
    await prisma.campaign.update({ where: { id: campId }, data: { whatsappInstanceId: instId } });
  });

  it("dailyLimit: excedente reagenda para o dia seguinte 08:00 (janela do lead), sem falhar", async () => {
    await reset();
    await setInst({ dailyLimit: 1 });
    const fake = new FakeWhatsAppProvider();
    const t1 = await mkTouch((await mkLead()).id);
    expect((await sendWhatsApp(t1.id, { now: new Date("2026-06-10T13:30:00Z"), provider: fake })).status).toBe("sent");
    const t2 = await mkTouch((await mkLead()).id);
    // 60s depois (intervalo mínimo já cumprido com rng 0 = 45s); limite estourou
    const r = await sendWhatsApp(t2.id, { now: new Date("2026-06-10T13:31:00Z"), provider: fake, rng: () => 0 });
    expect(r).toMatchObject({ status: "deferred", reason: "daily_limit" });
    const db = await get(t2.id);
    expect(db.status).toBe("scheduled");
    expect(db.scheduledAt?.toISOString()).toBe("2026-06-11T12:00:00.000Z");
    expect(fake.sent).toHaveLength(1);
    // lead em Tóquio: 8:00 SP do dia seguinte = 20:00 Tóquio -> fora da janela; vai para o próximo 09:00 Tóquio
    await reset();
    await setInst({ dailyLimit: 1 });
    const u1 = await mkTouch((await mkLead({ timezone: "Asia/Tokyo" })).id);
    expect((await sendWhatsApp(u1.id, { now: new Date("2026-06-10T02:00:00Z"), provider: fake })).status).toBe("sent"); // 11:00 Tóquio
    const u2 = await mkTouch((await mkLead({ timezone: "Asia/Tokyo" })).id);
    expect(await sendWhatsApp(u2.id, { now: new Date("2026-06-10T02:05:00Z"), provider: fake })).toMatchObject({ status: "deferred", reason: "daily_limit" });
    expect((await get(u2.id)).scheduledAt?.toISOString()).toBe("2026-06-11T00:00:00.000Z"); // 11/jun 09:00 Tóquio
  });

  it("dia novo (SP) zera a contagem", async () => {
    await reset();
    await setInst({ dailyLimit: 1 });
    const fake = new FakeWhatsAppProvider();
    const t1 = await mkTouch((await mkLead()).id);
    await sendWhatsApp(t1.id, { now: new Date("2026-06-10T13:30:00Z"), provider: fake });
    const t2 = await mkTouch((await mkLead()).id);
    expect((await sendWhatsApp(t2.id, { now: new Date("2026-06-11T13:30:00Z"), provider: fake })).status).toBe("sent");
  });

  it("intervalo mínimo 45-180s entre envios da mesma instância (deferral, sem sleep)", async () => {
    await reset();
    const fake = new FakeWhatsAppProvider();
    const t1 = await mkTouch((await mkLead()).id);
    await sendWhatsApp(t1.id, { now: IN_WINDOW, provider: fake });
    const t2 = await mkTouch((await mkLead()).id);
    const at = new Date(IN_WINDOW.getTime() + 5_000);
    const r = await sendWhatsApp(t2.id, { now: at, provider: fake, rng: () => 0 });
    expect(r).toMatchObject({ status: "deferred", reason: "min_interval" });
    expect((await get(t2.id)).scheduledAt?.getTime()).toBe(IN_WINDOW.getTime() + 45_000);
    expect(fake.sent).toHaveLength(1);
    const later = new Date(IN_WINDOW.getTime() + 181_000);
    expect((await sendWhatsApp(t2.id, { now: later, provider: fake })).status).toBe("sent");
  });

  it("429 -> deferred (retryable) respeitando Retry-After; Touch não fica em sending", async () => {
    await reset();
    const fake = new FakeWhatsAppProvider();
    fake.sendError = new AppError({ code: "rate_limited", userMessage: "WhatsApp (Evolution) recebeu requisições demais.", status: 429, retryable: true, retryAfterSeconds: 120 });
    const t = await mkTouch((await mkLead()).id);
    expect(await sendWhatsApp(t.id, { now: IN_WINDOW, provider: fake })).toMatchObject({ status: "deferred", reason: "rate_limited" });
    const db = await get(t.id);
    expect(db.status).toBe("scheduled");
    expect(db.scheduledAt?.getTime()).toBe(IN_WINDOW.getTime() + 120_000);
  });

  it("4xx -> failed (não retryable); 5xx -> failed com mensagem PT-BR; erro sanitizado <=200", async () => {
    await reset();
    const fake = new FakeWhatsAppProvider();
    fake.sendError = new AppError({ code: "validation", userMessage: "x ".repeat(300), status: 400 });
    const t = await mkTouch((await mkLead()).id);
    const r = await sendWhatsApp(t.id, { now: IN_WINDOW, provider: fake });
    expect(r.status === "failed" && r.error.retryable).toBe(false);
    expect((await get(t.id)).error!.length).toBeLessThanOrEqual(200);
    fake.sendError = new AppError({ code: "upstream", userMessage: "WhatsApp (Evolution) está com instabilidade.", status: 503, retryable: true });
    const t2 = await mkTouch((await mkLead()).id);
    await sendWhatsApp(t2.id, { now: IN_WINDOW, provider: fake });
    const db = await get(t2.id);
    expect(db.status).toBe("failed");
    expect(db.error).toMatch(/instabilidade/);
  });

  it("timeout no envio -> failed com aviso de não reenviar sem verificar", async () => {
    await reset();
    const fake = new FakeWhatsAppProvider();
    fake.sendError = new AppError({ code: "timeout", userMessage: "demorou", retryable: true });
    const t = await mkTouch((await mkLead()).id);
    await sendWhatsApp(t.id, { now: IN_WINDOW, provider: fake });
    const db = await get(t.id);
    expect(db.status).toBe("failed");
    expect(db.error).toBe(TIMEOUT_WARNING.slice(0, 200));
    expect(db.whatsappInstanceId).toBe(instId);
  });

  it("exceção inesperada nunca deixa Touch em sending", async () => {
    await reset();
    const fake = new FakeWhatsAppProvider();
    fake.sendText = async () => { throw new Error("boom com apikey=SEGREDO"); };
    const t = await mkTouch((await mkLead()).id);
    const r = await sendWhatsApp(t.id, { now: IN_WINDOW, provider: fake });
    expect(r.status).toBe("failed");
    const db = await get(t.id);
    expect(db.status).toBe("failed");
    expect(db.error).not.toContain("SEGREDO");
  });

  it("reserva atômica: dois envios concorrentes do mesmo Touch enviam uma vez", async () => {
    await reset();
    const fake = new FakeWhatsAppProvider();
    const t = await mkTouch((await mkLead()).id);
    const rs = await Promise.all([sendWhatsApp(t.id, { now: IN_WINDOW, provider: fake }), sendWhatsApp(t.id, { now: IN_WINDOW, provider: fake })]);
    expect(rs.map((r) => r.status).sort()).toEqual(["already_sent", "sent"]);
    expect(fake.sent).toHaveLength(1);
  });

  it("recupera Touch preso em sending há >15min; não mexe em sending recente", async () => {
    await reset();
    const fake = new FakeWhatsAppProvider();
    const recent = await mkTouch((await mkLead()).id, { status: "sending" });
    expect((await sendWhatsApp(recent.id, { now: IN_WINDOW, provider: fake })).status).toBe("already_sent");
    const stale = await mkTouch((await mkLead()).id, { status: "sending" });
    await prisma.$executeRaw`UPDATE "Touch" SET "updatedAt" = now() - interval '16 minutes' WHERE id = ${stale.id}`;
    expect((await sendWhatsApp(stale.id, { now: IN_WINDOW, provider: fake, rng: () => 0 })).status).toMatch(/sent|deferred/);
    expect((await get(stale.id)).status).not.toBe("sending");
  });
});
