import "dotenv/config";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ failSuppression: false }));
vi.mock("@/lib/domain/suppression", async (orig) => {
  const m = await orig<typeof import("@/lib/domain/suppression")>();
  return { ...m, addSuppression: (...a: Parameters<typeof m.addSuppression>) => { if (hoisted.failSuppression) throw new Error("boom"); return m.addSuppression(...a); } };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.AUTH_URL = "http://app.test";
process.env.ALLOW_PRIVATE_SMTP_HOSTS = "true";

import { prisma } from "@/lib/prisma";
import { purgeTestCampaigns } from "@/lib/test-utils/purge";
import { signInAsSeedAdmin } from "@/lib/auth/test-helpers";
import { seed } from "../../../prisma/seed";
import { encrypt } from "@/lib/crypto/secret-box";
import { AppError } from "@/lib/errors";
import { FakeWhatsAppProvider } from "@/lib/whatsapp/providers/fake";
import { sendWhatsApp } from "./whatsapp";
import { sendEmail } from "./email";
import { unsubscribeLead } from "./unsubscribe";
import { addSuppression, findSuppression, isSuppressed, removeSuppression } from "@/lib/domain/suppression";
import { processInbound } from "@/lib/domain/whatsapp-inbound";
import { evaluateInstanceHealth, onConnectionChange } from "@/lib/whatsapp/health";
import { handleWhatsAppWebhook } from "@/lib/whatsapp/webhook-handler";
import { addToSuppression, removeFromSuppression } from "@/lib/actions/suppression";
import { confirmOptOut } from "@/lib/actions/whatsapp";
import { resumeInstance, retryTouch } from "@/lib/actions/whatsapp-health";
import { createLead, updateLead } from "@/lib/actions/lead";
import { createTemplate } from "@/lib/actions/template";
import { isContactSuppressed, listSuppressions } from "@/lib/queries/suppression";
import { getInstanceHealth } from "@/lib/queries/whatsapp-health";
import { getLead, listLeads } from "@/lib/queries/leads";

const TAG = "zz-spec017";
const WED = new Date("2026-06-10T13:30:00Z"); // quarta, SP 10:30
const DAY = 24 * 3600_000;
const OLD_WARMUP = new Date("2026-01-01T00:00:00Z");
let campA = "";
let campB = "";
let stepId = "";
let userId = "";
let instId = "";
let n = 0;
const base = 10000000 + (Date.now() % 80000000);
const phones: string[] = [];
const newPhone = () => {
  const p = `+5511 9${String(base + ++n * 13).padStart(8, "0").slice(-8)}`.replace(" ", "");
  phones.push(p);
  return p;
};
const mkLead = (campaignId = campA, over: Record<string, unknown> = {}) =>
  prisma.lead.create({ data: { campaignId, name: `Ana ${++n}`, phone: newPhone(), email: `l${n}@${TAG}.com`, hasWhatsapp: true, ...over } });
const mkTouch = (leadId: string, over: Record<string, unknown> = {}) => prisma.touch.create({ data: { leadId, channel: "whatsapp", stepId, status: "scheduled", ...over } });
const get = (id: string) => prisma.touch.findUniqueOrThrow({ where: { id } });
const setInst = (data: Record<string, unknown>) => prisma.whatsAppInstance.update({ where: { id: instId }, data });
async function reset() {
  await prisma.touch.deleteMany({ where: { lead: { campaignId: { in: [campA, campB] } } } });
  await prisma.instanceAlert.deleteMany({ where: { instanceId: instId } });
  await setInst({ status: "connected", dailyLimit: 30, health: "good", pausedUntil: null, pausedReason: null, healthResetAt: null, warmupStartedAt: OLD_WARMUP });
}
const spyTransport = () => {
  const t = nodemailer.createTransport({ jsonTransport: true });
  const spy = vi.spyOn(t, "sendMail");
  return { t, spy };
};

beforeAll(async () => {
  await purgeTestCampaigns(TAG);
  await seed(prisma);
  await signInAsSeedAdmin();
  const user = await prisma.user.findFirstOrThrow({ where: { email: "admin@leadforge.local" } });
  userId = user.id;
  const icp = await prisma.icpProfile.findFirstOrThrow();
  const seq = await prisma.sequence.create({ data: { name: TAG } });
  instId = (await prisma.whatsAppInstance.create({ data: { instanceName: TAG, number: "+5511999990017", webhookToken: randomBytes(32).toString("base64url"), status: "connected", warmupStartedAt: OLD_WARMUP } })).id;
  campA = (await prisma.campaign.create({ data: { name: `${TAG}-A`, userId, icpId: icp.id, sequenceId: seq.id, whatsappInstanceId: instId } })).id;
  campB = (await prisma.campaign.create({ data: { name: `${TAG}-B`, userId, icpId: icp.id, sequenceId: seq.id, whatsappInstanceId: instId } })).id;
  const tpl = await prisma.messageTemplate.create({ data: { campaignId: campA, channel: "whatsapp", name: TAG, body: "{Oi|Olá|E aí} {{firstName}} da {{company}}" } });
  stepId = (await prisma.sequenceStep.create({ data: { sequenceId: seq.id, day: 0, channel: "whatsapp", templateId: tpl.id, order: 1 } })).id;
  await prisma.emailAccount.create({ data: { userId, provider: "smtp", smtpHost: "smtp.interno.local", email: `a1@${TAG}.com`, encryptedPassword: encrypt("x"), dailyLimit: 1000 } });
  const etpl = await prisma.messageTemplate.create({ data: { campaignId: campA, channel: "email", name: `${TAG}-e`, subject: "Oi", body: "Olá {{name}}" } });
  await prisma.sequenceStep.create({ data: { sequenceId: seq.id, day: 1, channel: "email", templateId: etpl.id, order: 2 } });
}, 30000);

afterAll(async () => {
  await purgeTestCampaigns(TAG).catch(() => {});
  await prisma.lead.deleteMany({ where: { campaignId: { in: [campA, campB] } } });
  await prisma.suppression.deleteMany({ where: { OR: [{ value: { contains: TAG } }, { value: { in: phones } }] } });
  await prisma.webhookEvent.deleteMany({ where: { source: "suppression", payload: { path: ["reason"], string_contains: TAG } } });
  await prisma.emailAccount.deleteMany({ where: { email: { contains: TAG } } });
  await prisma.sequenceStep.deleteMany({ where: { sequence: { name: TAG } } });
  await prisma.campaign.deleteMany({ where: { id: { in: [campA, campB] } } });
  await prisma.messageTemplate.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.sequence.deleteMany({ where: { name: TAG } });
  await prisma.whatsAppInstance.deleteMany({ where: { instanceName: TAG } });
  await prisma.$disconnect();
});

const emailStep = () => prisma.sequenceStep.findFirstOrThrow({ where: { sequence: { name: TAG }, channel: "email" } });

describe("supressão global: bloqueia envio", () => {
  it("WhatsApp: telefone suprimido -> skipped 'suprimido', provider NÃO é chamado", async () => {
    await reset();
    const fake = new FakeWhatsAppProvider();
    const lead = await mkLead();
    await addSuppression(undefined, { phone: lead.phone, reason: "manual" });
    const t = await mkTouch(lead.id);
    expect(await sendWhatsApp(t.id, { now: WED, provider: fake })).toMatchObject({ status: "skipped", reason: "suppressed" });
    expect(fake.sent).toHaveLength(0);
    expect(fake.checked).toHaveLength(0);
    expect(await get(t.id)).toMatchObject({ status: "skipped", error: "suprimido" });
  });
  it("WhatsApp: e-mail suprimido também bloqueia (qualquer contato do lead)", async () => {
    await reset();
    const fake = new FakeWhatsAppProvider();
    const lead = await mkLead();
    await addSuppression(undefined, { email: lead.email!.toUpperCase(), reason: "bounce" });
    const t = await mkTouch(lead.id);
    expect(await sendWhatsApp(t.id, { now: WED, provider: fake })).toMatchObject({ status: "skipped", reason: "suppressed" });
    expect(fake.sent).toHaveLength(0);
  });
  it("E-mail: suprimido -> skipped 'suprimido', transport NÃO é chamado", async () => {
    const lead = await mkLead();
    await addSuppression(undefined, { email: lead.email, reason: "opt_out_manual" });
    const step = await emailStep();
    const t = await prisma.touch.create({ data: { leadId: lead.id, channel: "email", stepId: step.id, status: "scheduled" } });
    const { t: tr, spy } = spyTransport();
    expect(await sendEmail(t.id, { transport: tr, now: WED })).toMatchObject({ status: "skipped", reason: "suppressed" });
    expect(spy).not.toHaveBeenCalled();
    expect(await get(t.id)).toMatchObject({ status: "skipped", error: "suprimido" });
  });
  it("isSuppressed normaliza (e-mail caixa alta/espaços; telefone com máscara) e removeSuppression libera", async () => {
    const e = `Norm@${TAG}.com`;
    await addSuppression(undefined, { email: e, reason: "manual" });
    await addSuppression(undefined, { email: e, reason: "bounce" }); // idempotente
    expect(await prisma.suppression.count({ where: { value: `norm@${TAG}.com` } })).toBe(1);
    expect((await prisma.suppression.findFirstOrThrow({ where: { value: `norm@${TAG}.com` } })).reason).toBe("manual");
    expect(await isSuppressed({ email: `  NORM@${TAG}.COM ` })).toBe(true);
    expect(await removeSuppression(undefined, { email: e })).toBe(1);
    expect(await findSuppression({ email: e })).toBeNull();
    const p = newPhone();
    await addSuppression(undefined, { phone: p, reason: "manual" });
    expect(await isSuppressed({ phone: `(${p.slice(3, 5)}) ${p.slice(5, 10)}-${p.slice(10)}` })).toBe(true);
  });
});

describe("supressão global: toda origem de opt-out grava e vale para OUTRA campanha", () => {
  it("opt-out por resposta WhatsApp (processInbound) -> lead da campanha B com mesmo telefone não recebe", async () => {
    await reset();
    const a = await mkLead(campA);
    await prisma.opportunity.create({ data: { leadId: a.id, campaignId: campA, stage: "contactado" } });
    await prisma.$transaction((tx) => processInbound(tx, { id: instId }, { from: a.phone!, text: "PARAR", externalId: `${TAG}-in1`, timestamp: WED }, WED));
    const sup = await prisma.suppression.findMany({ where: { OR: [{ value: a.phone! }, { value: a.email! }] } });
    expect(sup.map((s) => s.kind).sort()).toEqual(["email", "phone"]);
    expect(new Set(sup.map((s) => s.reason))).toEqual(new Set(["opt_out_reply"]));
    const b = await mkLead(campB, { phone: a.phone, email: null });
    const fake = new FakeWhatsAppProvider();
    const t = await mkTouch(b.id);
    expect(await sendWhatsApp(t.id, { now: WED, provider: fake })).toMatchObject({ status: "skipped", reason: "suppressed" });
    expect(fake.sent).toHaveLength(0);
  });
  it("confirmOptOut (possível opt-out confirmado) grava possible_opt_out_confirmed", async () => {
    const a = await mkLead(campA, { possibleOptOut: true });
    await prisma.opportunity.create({ data: { leadId: a.id, campaignId: campA, stage: "contactado" } });
    expect(await confirmOptOut(a.id)).toMatchObject({ ok: true });
    expect((await prisma.suppression.findFirstOrThrow({ where: { value: a.phone! } })).reason).toBe("possible_opt_out_confirmed");
  });
  it("link de descadastro (unsubscribeLead) -> e-mail+telefone; lead de outra campanha com mesmo e-mail não recebe", async () => {
    const a = await mkLead(campA);
    expect(await unsubscribeLead(a.id)).toBe(true);
    expect(await unsubscribeLead(a.id)).toBe(true); // idempotente
    const sup = await prisma.suppression.findMany({ where: { OR: [{ value: a.phone! }, { value: a.email! }] } });
    expect(sup).toHaveLength(2);
    expect(sup.every((s) => s.reason === "opt_out_link" && s.leadId === a.id)).toBe(true);
    const b = await mkLead(campB, { email: a.email, phone: newPhone() });
    const step = await emailStep();
    const t = await prisma.touch.create({ data: { leadId: b.id, channel: "email", stepId: step.id, status: "scheduled" } });
    const { t: tr, spy } = spyTransport();
    expect(await sendEmail(t.id, { transport: tr, now: WED })).toMatchObject({ status: "skipped", reason: "suppressed" });
    expect(spy).not.toHaveBeenCalled();
  });
  it("ação manual addToSuppression (lead) e (contato solto); remove exige confirmação e motivo; consulta/listagem", async () => {
    const a = await mkLead(campA);
    expect(await addToSuppression({ leadId: a.id })).toMatchObject({ ok: true, data: { added: 2 } });
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: a.id } });
    expect(lead).toMatchObject({ sequenceStatus: "opted_out" });
    expect(lead.optedOutAt).not.toBeNull();
    const sup = await prisma.suppression.findFirstOrThrow({ where: { value: a.phone! } });
    expect(sup.reason).toBe("opt_out_manual");
    const solto = `solto@${TAG}.com`;
    expect(await addToSuppression({ email: solto, reason: "bounce", note: "voltou" })).toMatchObject({ ok: true, data: { added: 1 } });
    expect(await addToSuppression({})).toMatchObject({ ok: false });
    expect(await addToSuppression({ email: "nao-e-email" })).toMatchObject({ ok: false });
    expect(await isContactSuppressed({ email: solto })).toEqual({ suppressed: true, reason: "bounce" });
    expect(await isContactSuppressed({ email: `livre@${TAG}.com` })).toEqual({ suppressed: false, reason: null });
    const list = await listSuppressions({ q: TAG, kind: "email" });
    expect(list.items.some((i) => i.value === solto)).toBe(true);
    const row = await prisma.suppression.findFirstOrThrow({ where: { value: solto } });
    expect(await removeFromSuppression({ id: row.id, reason: `${TAG} curto` })).toMatchObject({ ok: false }); // sem confirmação
    expect(await removeFromSuppression({ id: row.id, reason: "x", confirm: true })).toMatchObject({ ok: false }); // motivo curto
    expect(await removeFromSuppression({ id: row.id, reason: `${TAG} cliente pediu para voltar`, confirm: true })).toMatchObject({ ok: true });
    expect(await isSuppressed({ email: solto })).toBe(false);
    const ev = await prisma.webhookEvent.findFirst({ where: { source: "suppression", payload: { path: ["reason"], string_contains: TAG } } });
    expect(ev?.payload).toMatchObject({ action: "removed", kind: "email", originalReason: "bounce" });
    expect(JSON.stringify(ev?.payload)).not.toContain(solto);
  });
  it("createLead/updateLead: cria mesmo suprimido, com suppressed: true aditivo", async () => {
    const email = `criar@${TAG}.com`;
    await addSuppression(undefined, { email, reason: "manual" });
    const r = await createLead({ campaignId: campB, name: "Suprimida", email });
    expect(r).toMatchObject({ ok: true, data: { suppressed: true } });
    const ok = await createLead({ campaignId: campA, name: "Livre", email: `livre2@${TAG}.com` });
    expect(ok).toMatchObject({ ok: true, data: { suppressed: false } });
    if (!ok.ok) throw new Error("x");
    expect(await updateLead({ leadId: ok.data.id, email })).toMatchObject({ ok: true, data: { suppressed: true } });
    const detail = await getLead(ok.data.id);
    expect(detail?.suppressed).toBe(true);
    const list = await listLeads({ campaignId: campA, q: TAG });
    expect(list.items.find((i) => i.id === ok.data.id)?.suppressed).toBe(true);
  });
});

describe("cadência gentil", () => {
  const sentTouch = (leadId: string, ago: number, channel: "whatsapp" | "email" = "whatsapp") =>
    prisma.touch.create({ data: { leadId, channel, status: "sent", sentAt: new Date(WED.getTime() - ago), whatsappInstanceId: channel === "whatsapp" ? instId : null } });

  it("4º toque em 14 dias -> skipped 'limite de toques'; toque de 15 dias atrás não conta", async () => {
    await reset();
    const fake = new FakeWhatsAppProvider();
    const lead = await mkLead();
    for (const d of [13, 9, 5]) await sentTouch(lead.id, d * DAY);
    const t = await mkTouch(lead.id);
    expect(await sendWhatsApp(t.id, { now: WED, provider: fake })).toMatchObject({ status: "skipped", reason: "touch_limit" });
    expect(await get(t.id)).toMatchObject({ status: "skipped", error: "limite de toques" });
    expect(fake.sent).toHaveLength(0);
    const l2 = await mkLead();
    for (const d of [15, 9, 5]) await sentTouch(l2.id, d * DAY);
    const t2 = await mkTouch(l2.id);
    expect((await sendWhatsApp(t2.id, { now: WED, provider: fake })).status).toBe("sent");
  });
  it("mínimo 3 dias entre toques: 2 dias -> scheduled no 1º instante permitido; 3 dias+ envia", async () => {
    await reset();
    const fake = new FakeWhatsAppProvider();
    const lead = await mkLead();
    await sentTouch(lead.id, 2 * DAY); // seg 8/jun 13:30Z
    const t = await mkTouch(lead.id);
    expect(await sendWhatsApp(t.id, { now: WED, provider: fake })).toMatchObject({ status: "deferred", reason: "min_gap" });
    expect((await get(t.id)).scheduledAt?.toISOString()).toBe("2026-06-11T13:30:00.000Z"); // quinta 10:30 SP (dentro da janela)
    expect(fake.sent).toHaveLength(0);
    expect(await sendWhatsApp(t.id, { now: new Date("2026-06-11T13:30:00Z"), provider: fake })).toMatchObject({ status: "sent" });
    await reset();
    const l2 = await mkLead();
    await sentTouch(l2.id, 3 * DAY);
    expect((await sendWhatsApp((await mkTouch(l2.id)).id, { now: WED, provider: fake, rng: () => 0 })).status).toBe("sent");
  });
  it("mínimo 3 dias caindo fora da janela vai para o próximo início de janela", async () => {
    await reset();
    const lead = await mkLead();
    await sentTouch(lead.id, 2 * DAY + 3 * 3600_000); // seg 10:30Z -> +3d = qui 10:30Z = 07:30 SP (antes da janela)
    const t = await mkTouch(lead.id);
    const r = await sendWhatsApp(t.id, { now: WED, provider: new FakeWhatsAppProvider() });
    expect(r).toMatchObject({ status: "deferred", reason: "min_gap" });
    expect((await get(t.id)).scheduledAt?.toISOString()).toBe("2026-06-11T12:00:00.000Z"); // 09:00 SP
  });
  it("nunca dois canais no mesmo dia: e-mail hoje adia o WhatsApp; WhatsApp hoje adia o e-mail", async () => {
    await reset();
    const fake = new FakeWhatsAppProvider();
    const lead = await mkLead();
    await sentTouch(lead.id, 3600_000, "email");
    const t = await mkTouch(lead.id);
    expect(await sendWhatsApp(t.id, { now: WED, provider: fake })).toMatchObject({ status: "deferred", reason: "other_channel_today" });
    expect((await get(t.id)).scheduledAt?.toISOString()).toBe("2026-06-11T12:00:00.000Z");
    expect(fake.sent).toHaveLength(0);
    const l2 = await mkLead();
    await sentTouch(l2.id, 3600_000, "whatsapp");
    const step = await emailStep();
    const et = await prisma.touch.create({ data: { leadId: l2.id, channel: "email", stepId: step.id, status: "scheduled" } });
    const { t: tr, spy } = spyTransport();
    expect(await sendEmail(et.id, { transport: tr, now: WED })).toMatchObject({ status: "deferred" });
    expect(spy).not.toHaveBeenCalled();
  });
  it("janela: fim de semana e feriado reagendam para o próximo dia útil", async () => {
    await reset();
    const fake = new FakeWhatsAppProvider();
    const t = await mkTouch((await mkLead()).id);
    expect(await sendWhatsApp(t.id, { now: new Date("2026-06-13T13:30:00Z"), provider: fake })).toMatchObject({ status: "deferred", reason: "outside_window" }); // sábado
    expect((await get(t.id)).scheduledAt?.toISOString()).toBe("2026-06-15T12:00:00.000Z");
    const h = await mkTouch((await mkLead()).id);
    expect(await sendWhatsApp(h.id, { now: new Date("2026-09-07T13:30:00Z"), provider: fake })).toMatchObject({ status: "deferred", reason: "outside_window" }); // Independência
    expect((await get(h.id)).scheduledAt?.toISOString()).toBe("2026-09-08T12:00:00.000Z");
    const noon = await mkTouch((await mkLead()).id);
    expect((await sendWhatsApp(noon.id, { now: new Date("2026-06-10T15:00:00Z"), provider: fake })).status).toBe("deferred"); // 12:00 SP
    expect(fake.sent).toHaveLength(0);
  });
  it("spintax: texto enviado é uma variante e é determinístico por lead+passo", async () => {
    await reset();
    const fake = new FakeWhatsAppProvider();
    const lead = await mkLead(campA, { company: "Acme" });
    await sendWhatsApp((await mkTouch(lead.id)).id, { now: WED, provider: fake });
    expect(fake.sent[0].text).toMatch(/^(Oi|Olá|E aí) Ana \d* ?da Acme$|^(Oi|Olá|E aí) Ana da Acme$/);
    const { expandSpintax } = await import("@/lib/templates/spintax");
    const expected = expandSpintax("{Oi|Olá|E aí} {{firstName}} da {{company}}", `${lead.id}:${stepId}`).replace("{{firstName}}", "Ana").replace("{{company}}", "Acme");
    expect(fake.sent[0].text).toBe(expected);
  });
});

describe("aquecimento por instância", () => {
  it("dia 1: limite efetivo 3/dia; excedente -> daily_limit no dia seguinte", async () => {
    await reset();
    await setInst({ warmupStartedAt: WED });
    const fake = new FakeWhatsAppProvider();
    for (let i = 0; i < 3; i++) {
      const r = await sendWhatsApp((await mkTouch((await mkLead()).id)).id, { now: new Date(WED.getTime() + i * 200_000), provider: fake, rng: () => 0 });
      expect(r.status).toBe("sent");
    }
    const t = await mkTouch((await mkLead()).id);
    expect(await sendWhatsApp(t.id, { now: new Date(WED.getTime() + 600_000), provider: fake, rng: () => 0 })).toMatchObject({ status: "deferred", reason: "daily_limit" });
    expect((await get(t.id)).scheduledAt?.toISOString()).toBe("2026-06-11T12:00:00.000Z");
    expect(fake.sent).toHaveLength(3);
  });
  it("teto configurado abaixo da rampa vale (dailyLimit 1 na semana 4+)", async () => {
    await reset();
    await setInst({ dailyLimit: 1 });
    const fake = new FakeWhatsAppProvider();
    expect((await sendWhatsApp((await mkTouch((await mkLead()).id)).id, { now: WED, provider: fake })).status).toBe("sent");
    expect((await sendWhatsApp((await mkTouch((await mkLead()).id)).id, { now: new Date(WED.getTime() + 300_000), provider: fake })).status).toBe("deferred");
  });
  it("intervalo humano: 2º envio em 10s é adiado para >= 45s", async () => {
    await reset();
    const fake = new FakeWhatsAppProvider();
    await sendWhatsApp((await mkTouch((await mkLead()).id)).id, { now: WED, provider: fake });
    const t = await mkTouch((await mkLead()).id);
    expect(await sendWhatsApp(t.id, { now: new Date(WED.getTime() + 10_000), provider: fake, rng: () => 0 })).toMatchObject({ status: "deferred", reason: "min_interval" });
    expect((await get(t.id)).scheduledAt?.getTime()).toBe(WED.getTime() + 45_000);
  });
  it("1ª transição para connected define warmupStartedAt (e não sobrescreve)", async () => {
    await reset();
    await setInst({ warmupStartedAt: null });
    await onConnectionChange({ id: instId, status: "connecting" }, "connected", WED);
    expect((await prisma.whatsAppInstance.findUniqueOrThrow({ where: { id: instId } })).warmupStartedAt).toEqual(WED);
    await onConnectionChange({ id: instId, status: "connecting" }, "connected", new Date(WED.getTime() + DAY));
    expect((await prisma.whatsAppInstance.findUniqueOrThrow({ where: { id: instId } })).warmupStartedAt).toEqual(WED);
  });
});

describe("verificar número (checkNumbers)", () => {
  it("sem WhatsApp -> skipped 'número sem WhatsApp', cacheado; não checa de novo", async () => {
    await reset();
    const fake = new FakeWhatsAppProvider();
    const lead = await mkLead(campA, { hasWhatsapp: null });
    fake.noWhatsapp.add(lead.phone!);
    const t = await mkTouch(lead.id);
    expect(await sendWhatsApp(t.id, { now: WED, provider: fake })).toMatchObject({ status: "skipped", reason: "no_whatsapp" });
    expect(await get(t.id)).toMatchObject({ status: "skipped", error: "número sem WhatsApp" });
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ hasWhatsapp: false });
    expect(fake.sent).toHaveLength(0);
    expect(fake.checked).toHaveLength(1);
    const t2 = await mkTouch(lead.id, { stepId: null });
    await sendWhatsApp(t2.id, { now: WED, provider: fake });
    expect(fake.checked).toHaveLength(1);
  });
  it("com WhatsApp: checa 1x, cacheia e envia", async () => {
    await reset();
    const fake = new FakeWhatsAppProvider();
    const lead = await mkLead(campA, { hasWhatsapp: null });
    expect((await sendWhatsApp((await mkTouch(lead.id)).id, { now: WED, provider: fake })).status).toBe("sent");
    const db = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(db.hasWhatsapp).toBe(true);
    expect(db.whatsappCheckedAt).toEqual(WED);
    expect(fake.checked).toEqual([[lead.phone]]);
  });
  it("falha na checagem (429/timeout) -> deferred, NUNCA envia às cegas e não cacheia", async () => {
    await reset();
    const fake = new FakeWhatsAppProvider();
    const lead = await mkLead(campA, { hasWhatsapp: null });
    fake.checkError = new AppError({ code: "rate_limited", userMessage: "muitas requisições", status: 429, retryable: true, retryAfterSeconds: 30 });
    const t = await mkTouch(lead.id);
    expect(await sendWhatsApp(t.id, { now: WED, provider: fake })).toMatchObject({ status: "deferred", reason: "number_check_failed" });
    expect(fake.sent).toHaveLength(0);
    expect((await get(t.id)).status).toBe("scheduled");
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).hasWhatsapp).toBeNull();
    fake.checkError = new AppError({ code: "timeout", userMessage: "demorou", retryable: true });
    expect(await sendWhatsApp(t.id, { now: WED, provider: fake })).toMatchObject({ status: "deferred", reason: "number_check_failed" });
    expect(fake.sent).toHaveLength(0);
  });
});

describe("saúde e disjuntor", () => {
  const seedSends = async (statuses: ("sent" | "delivered")[], opts: { optedIdx?: number[]; ago?: number } = {}) => {
    const now = new Date();
    for (let i = 0; i < statuses.length; i++) {
      const lead = await mkLead(campA, opts.optedIdx?.includes(i) ? { possibleOptOut: true } : {});
      await prisma.touch.create({ data: { leadId: lead.id, channel: "whatsapp", status: statuses[i], sentAt: new Date(now.getTime() - (opts.ago ?? 3600_000) - i * 60_000), whatsappInstanceId: instId } });
    }
    return now;
  };
  const state = () => prisma.whatsAppInstance.findUniqueOrThrow({ where: { id: instId } });

  it("gatilho: 2 falhas consecutivas pausa (24h) e cria alerta", async () => {
    await reset();
    const lead = await mkLead();
    for (let i = 0; i < 2; i++) await prisma.touch.create({ data: { leadId: lead.id, channel: "whatsapp", stepId: i ? null : undefined, status: "failed", error: "x", whatsappInstanceId: instId } });
    const now = new Date();
    expect(await evaluateInstanceHealth(instId, now)).toBe("paused");
    const s = await state();
    expect(s.health).toBe("paused");
    expect(s.pausedReason).toMatch(/falhas/);
    expect(s.pausedUntil!.getTime() - now.getTime()).toBe(24 * 3600_000);
    expect(await prisma.instanceAlert.count({ where: { instanceId: instId, kind: "paused" } })).toBe(1);
  });
  it("gatilho: entrega < 80% nos últimos 20 pausa; 90% não", async () => {
    await reset();
    const now = await seedSends([...Array(14).fill("delivered"), ...Array(6).fill("sent")]);
    expect(await evaluateInstanceHealth(instId, now)).toBe("paused");
    expect((await state()).pausedReason).toMatch(/entrega/);
    await reset();
    await prisma.touch.deleteMany({ where: { lead: { campaignId: campA } } });
    const now2 = await seedSends([...Array(18).fill("delivered"), ...Array(2).fill("sent")]);
    expect(await evaluateInstanceHealth(instId, now2)).toBe("good");
  });
  it("gatilho: opt-out/possível opt-out > 5% dos envios pausa (amostra >= 20)", async () => {
    await reset();
    const now = await seedSends(Array(25).fill("delivered"), { optedIdx: [0, 1] });
    expect(await evaluateInstanceHealth(instId, now)).toBe("paused");
    expect((await state()).pausedReason).toMatch(/opt-out/i);
  });
  it("amostra pequena não dispara (3 envios, 1 opt-out)", async () => {
    await reset();
    const now = await seedSends(["sent", "sent", "sent"], { optedIdx: [0] });
    expect(["good", "warning"]).toContain(await evaluateInstanceHealth(instId, now));
  });
  it("logout confirmado pausa 48h na hora; queda simples só marca disconnectedAt; connecting a partir de não-conectada não marca", async () => {
    await reset();
    await setInst({ disconnectedAt: null });
    await onConnectionChange({ id: instId, status: "connecting" }, "disconnected", WED);
    expect((await state()).health).toBe("good");
    expect((await state()).disconnectedAt).toBeNull();
    await onConnectionChange({ id: instId, status: "connected" }, "disconnected", WED);
    expect((await state()).health).toBe("good");
    expect((await state()).disconnectedAt).toEqual(WED);
    await onConnectionChange({ id: instId, status: "disconnected" }, "disconnected", WED, { loggedOut: true });
    const s = await state();
    expect(s.health).toBe("paused");
    expect(s.pausedUntil!.getTime() - WED.getTime()).toBe(48 * 3600_000);
  });
  it("queda: blip de 2 min não pausa; 15 min pausa (via evaluateInstanceHealth); reconexão zera e cria no máximo 1 warning", async () => {
    await reset();
    await setInst({ disconnectedAt: null });
    await onConnectionChange({ id: instId, status: "connected" }, "disconnected", WED);
    await setInst({ status: "disconnected" });
    expect(await evaluateInstanceHealth(instId, new Date(WED.getTime() + 2 * 60_000))).not.toBe("paused");
    await onConnectionChange({ id: instId, status: "disconnected" }, "connected", new Date(WED.getTime() + 3 * 60_000));
    await onConnectionChange({ id: instId, status: "connected" }, "connected", new Date(WED.getTime() + 4 * 60_000));
    expect((await state()).disconnectedAt).toBeNull();
    expect((await state()).health).not.toBe("paused");
    expect(await prisma.instanceAlert.count({ where: { instanceId: instId, kind: "warning" } })).toBe(1);
    await setInst({ status: "connected" });
    await onConnectionChange({ id: instId, status: "connected" }, "disconnected", WED);
    await setInst({ status: "disconnected" });
    expect(await evaluateInstanceHealth(instId, new Date(WED.getTime() + 15 * 60_000))).toBe("paused");
    await setInst({ status: "connected" });
  });
  it("disjuntor integrado: 2 falhas reais de envio pausam a instância; depois paused bloqueia (Touch scheduled até pausedUntil, provider não chamado)", async () => {
    await reset();
    const fake = new FakeWhatsAppProvider();
    fake.sendError = new AppError({ code: "upstream", userMessage: "WhatsApp (Evolution) está com instabilidade.", status: 503, retryable: true });
    const inWin = new Date("2026-06-10T13:30:00Z");
    await sendWhatsApp((await mkTouch((await mkLead()).id)).id, { now: inWin, provider: fake, rng: () => 0 });
    await sendWhatsApp((await mkTouch((await mkLead()).id)).id, { now: new Date(inWin.getTime() + 300_000), provider: fake, rng: () => 0 });
    expect((await state()).health).toBe("paused");
    const fake2 = new FakeWhatsAppProvider();
    const t = await mkTouch((await mkLead()).id);
    const r = await sendWhatsApp(t.id, { now: new Date(), provider: fake2 });
    // "agora" real pode estar fora da janela: o essencial é que nada foi enviado nem checado
    expect(fake2.sent).toHaveLength(0);
    expect(fake2.checked).toHaveLength(0);
    expect(r.status).toBe("deferred");
    expect(await get(t.id)).toMatchObject({ status: "scheduled" });
  });
  it("paused bloqueia envio dentro da janela: reason instance_paused, agendado >= pausedUntil", async () => {
    await reset();
    const until = new Date(WED.getTime() + 24 * 3600_000);
    await setInst({ health: "paused", pausedUntil: until, pausedReason: "teste" });
    const fake = new FakeWhatsAppProvider();
    const t = await mkTouch((await mkLead()).id);
    expect(await sendWhatsApp(t.id, { now: WED, provider: fake })).toMatchObject({ status: "deferred", reason: "instance_paused" });
    expect((await get(t.id)).scheduledAt!.getTime()).toBeGreaterThanOrEqual(until.getTime());
    expect(fake.sent).toHaveLength(0);
  });
  it("retomada automática após o prazo: envia com rampa reduzida (um degrau) e alerta 'resumed'", async () => {
    await reset();
    await setInst({ health: "paused", pausedUntil: new Date(WED.getTime() - 1000), pausedReason: "teste", warmupStartedAt: new Date(WED.getTime() - 24 * DAY) }); // dia 25 -> recua p/ dia 15 (20/dia)
    const fake = new FakeWhatsAppProvider();
    expect((await sendWhatsApp((await mkTouch((await mkLead()).id)).id, { now: WED, provider: fake })).status).toBe("sent");
    const s = await state();
    expect(s).toMatchObject({ health: "good", pausedUntil: null, pausedReason: null });
    const { warmupDay } = await import("@/lib/whatsapp/warmup");
    expect(warmupDay(s.warmupStartedAt, WED)).toBe(15);
    expect(await prisma.instanceAlert.count({ where: { instanceId: instId, kind: "resumed" } })).toBe(1);
  });
  it("resumeInstance manual: reinicia a rampa em degrau anterior, zera métricas antigas (não re-pausa) e é idempotente", async () => {
    await reset();
    const lead = await mkLead();
    for (let i = 0; i < 2; i++) await prisma.touch.create({ data: { leadId: lead.id, channel: "whatsapp", status: "failed", whatsappInstanceId: instId } });
    await evaluateInstanceHealth(instId, new Date());
    expect((await state()).health).toBe("paused");
    expect(await resumeInstance(instId)).toEqual({ ok: true, data: { id: instId, resumed: true } });
    const s = await state();
    expect(s).toMatchObject({ health: "good", pausedUntil: null });
    expect(s.warmupStartedAt!.getTime()).toBeGreaterThan(OLD_WARMUP.getTime()); // recuou um degrau (de semana 4+ para dia 15)
    expect(await evaluateInstanceHealth(instId, new Date())).toBe("good"); // falhas antigas ignoradas (healthResetAt)
    expect(await resumeInstance(instId)).toEqual({ ok: true, data: { id: instId, resumed: false } });
    expect(await resumeInstance("00000000-0000-4000-8000-000000000000")).toMatchObject({ ok: false });
  });
  it("getInstanceHealth: estado, motivo, pausedUntil, dia de aquecimento, limite efetivo e métricas", async () => {
    await reset();
    const until = new Date(Date.now() + 3600_000);
    await setInst({ health: "paused", pausedUntil: until, pausedReason: "motivo x", warmupStartedAt: new Date(Date.now() - 8 * DAY) });
    const h = await getInstanceHealth(instId);
    expect(h).toMatchObject({ state: "paused", pausedReason: "motivo x", warmupDay: 9, dailyLimitCeiling: 30, effectiveLimitToday: 0 });
    expect(h!.pausedUntil).toEqual(until);
    expect(h!.metrics).toMatchObject({ sends: 0, consecutiveFailures: 0 });
    await setInst({ health: "good" });
    expect((await getInstanceHealth(instId))!.effectiveLimitToday).toBe(12);
    expect(await getInstanceHealth("00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

describe("invariante: nenhuma resposta automática ao lead", () => {
  it("webhook de resposta (inclusive opt-out) não chama sendText e não cria Touch outbound", async () => {
    await reset();
    const fake = new FakeWhatsAppProvider();
    const inst = await prisma.whatsAppInstance.findUniqueOrThrow({ where: { id: instId } });
    const lead = await mkLead(campA);
    await prisma.opportunity.create({ data: { leadId: lead.id, campaignId: campA, stage: "contactado" } });
    const before = await prisma.touch.count({ where: { leadId: lead.id, direction: "outbound" } });
    for (const text of ["Sim, tenho interesse", "PARAR"]) {
      fake.next = { kind: "inbound", instanceName: TAG, from: lead.phone!, pushName: "Ana", text, externalId: `${TAG}-${text.length}-${Date.now()}`, timestamp: new Date() };
      const res = await handleWhatsAppWebhook(new Request("http://x/api/webhooks/whatsapp/t", { method: "POST", body: "{}" }), inst.webhookToken, { provider: fake });
      expect(res.status).toBe(200);
    }
    expect(fake.sent).toHaveLength(0);
    expect(await prisma.touch.count({ where: { leadId: lead.id, direction: "outbound" } })).toBe(before);
    expect(await prisma.touch.count({ where: { leadId: lead.id, direction: "inbound" } })).toBe(2);
    await prisma.webhookEvent.deleteMany({ where: { source: "whatsapp", eventId: { startsWith: `wa:${instId}:` } } });
  });
  it("estático: handler, domínio de inbound e classificador nunca referenciam sendText", () => {
    for (const f of ["src/lib/whatsapp/webhook-handler.ts", "src/lib/domain/whatsapp-inbound.ts", "src/lib/domain/whatsapp-optout.ts", "src/lib/domain/suppression.ts"]) {
      expect(readFileSync(path.resolve(process.cwd(), f), "utf8"), f).not.toMatch(/sendText|sendWhatsApp/);
    }
  });
  it("estático: channels/whatsapp.ts não importa o caminho de inbound e só tem UM sendText, precedido da checagem leadStopped", () => {
    const src = readFileSync(path.resolve(process.cwd(), "src/lib/channels/whatsapp.ts"), "utf8");
    expect(src).not.toMatch(/whatsapp-inbound|webhook-handler|processInbound/);
    expect(src.match(/\.sendText\(/g)).toHaveLength(1);
    expect(src.indexOf("leadStopped(")).toBeGreaterThan(-1);
    expect(src.indexOf("leadStopped(")).toBeLessThan(src.indexOf(".sendText("));
    for (const f of ["src/lib/whatsapp/webhook-handler.ts", "src/lib/domain/whatsapp-inbound.ts"]) {
      expect(readFileSync(path.resolve(process.cwd(), f), "utf8"), f).not.toMatch(/channels\/(whatsapp|email)/);
    }
  });
  it("inbound entre a reserva e o envio: skipped, provider NÃO chamado (WhatsApp e e-mail)", async () => {
    await reset();
    const lead = await mkLead(campA, { hasWhatsapp: null });
    const touch = await mkTouch(lead.id);
    const fake = new FakeWhatsAppProvider();
    const orig = fake.checkNumbers.bind(fake);
    fake.checkNumbers = async (...a) => {
      await prisma.lead.update({ where: { id: lead.id }, data: { repliedAt: new Date(), sequenceStatus: "paused_replied" } });
      return orig(...a);
    };
    const r = await sendWhatsApp(touch.id, { now: WED, provider: fake, rng: () => 0 });
    expect(r).toEqual({ status: "skipped", reason: "replied" });
    expect(fake.sent).toHaveLength(0);
    expect((await get(touch.id)).status).toBe("skipped");

    const l2 = await mkLead(campA, { repliedAt: new Date(Date.now() + 60_000) });
    const et = await prisma.touch.create({ data: { leadId: l2.id, channel: "email", stepId: (await emailStep()).id, status: "scheduled" } });
    const { t, spy } = spyTransport();
    expect(await sendEmail(et.id, { now: WED, transport: t })).toEqual({ status: "skipped", reason: "replied" });
    expect(spy).not.toHaveBeenCalled();
  });
  it("Touch failed por timeout NÃO é reservado automaticamente; retryTouch (confirm) o reagenda; falha segura é reservada", async () => {
    await reset();
    const fake = new FakeWhatsAppProvider();
    const lead = await mkLead(campA);
    const timeoutT = await mkTouch(lead.id, { status: "failed", error: "Não foi possível confirmar o envio; verifique no WhatsApp antes de reenviar." });
    expect(await sendWhatsApp(timeoutT.id, { now: WED, provider: fake, rng: () => 0 })).toEqual({ status: "already_sent" });
    expect(fake.sent).toHaveLength(0);
    expect((await get(timeoutT.id)).status).toBe("failed");
    expect(await retryTouch({ touchId: timeoutT.id })).toMatchObject({ ok: false });
    expect(await retryTouch({ touchId: timeoutT.id, confirm: true })).toMatchObject({ ok: true });
    expect((await get(timeoutT.id)).status).toBe("scheduled");
    expect(await sendWhatsApp(timeoutT.id, { now: WED, provider: fake, rng: () => 0 })).toMatchObject({ status: "sent" });
    const safe = await mkTouch((await mkLead(campA)).id, { status: "failed", error: "instabilidade" });
    expect((await sendWhatsApp(safe.id, { now: WED, provider: fake, rng: () => 0 })).status).not.toBe("already_sent"); // reservado (pode adiar por intervalo)
  });
  it("suprimido: consulta ANTES da reserva (Touch nunca vira sending; failed também vira skipped)", async () => {
    await reset();
    const lead = await mkLead(campA);
    await addSuppression(undefined, { phone: lead.phone, reason: "manual" });
    const fake = new FakeWhatsAppProvider();
    const t = await mkTouch(lead.id, { status: "failed", error: "instabilidade" });
    expect(await sendWhatsApp(t.id, { now: WED, provider: fake, rng: () => 0 })).toEqual({ status: "skipped", reason: "suppressed" });
    expect(await get(t.id)).toMatchObject({ status: "skipped", error: "suprimido" });
    expect(fake.sent).toHaveLength(0);
  });
  it("unsubscribeLead é atômico: falha na supressão desfaz o opt-out do lead", async () => {
    const lead = await mkLead(campA);
    hoisted.failSuppression = true;
    try { await expect(unsubscribeLead(lead.id)).rejects.toThrow(/boom/); } finally { hoisted.failSuppression = false; }
    const cur = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(cur.optedOutAt).toBeNull();
    expect(cur.sequenceStatus).not.toBe("opted_out");
    expect(await unsubscribeLead(lead.id)).toBe(true);
    expect(await isSuppressed({ email: lead.email })).toBe(true);
  });
  it("backfill complementar (SQL da migration 200000): normaliza telefone e cobre opted_out sem optedOutAt; idempotente", async () => {
    const lead = await mkLead(campA, { phone: "(11) 9 8123-4567" , sequenceStatus: "opted_out", email: `bf@${TAG}.com` });
    const sql = readFileSync(path.resolve(process.cwd(), "prisma/migrations/20260919200000_disconnected_at_backfill_fix/migration.sql"), "utf8")
      .split("\n").filter((l) => !l.startsWith("--") && !l.startsWith("ALTER") && !l.startsWith("-- AlterTable")).join("\n");
    for (let i = 0; i < 2; i++) for (const stmt of sql.split(/;\s*\n/).map((x) => x.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(stmt);
    expect(await prisma.suppression.count({ where: { kind: "phone", value: "+5511981234567" } })).toBe(1);
    expect(await prisma.suppression.count({ where: { kind: "email", value: `bf@${TAG}.com` } })).toBe(1);
    await prisma.suppression.deleteMany({ where: { value: "+5511981234567" } });
    void lead;
  });
});

describe("template: warnings e validação de spintax", () => {
  it("createTemplate WhatsApp devolve warnings (aditivo) e rejeita spintax inválido em PT-BR", async () => {
    const ok = await createTemplate({ campaignId: campA, channel: "whatsapp", name: `${TAG}-w`, body: "Oi {{firstName}}, veja https://x.com aproveite o desconto" });
    expect(ok).toMatchObject({ ok: true });
    if (!ok.ok) throw new Error("x");
    expect(ok.data.warnings.length).toBeGreaterThanOrEqual(3);
    const bad = await createTemplate({ campaignId: campA, channel: "whatsapp", name: `${TAG}-w2`, body: "Oi {a|b" });
    expect(bad).toMatchObject({ ok: false, errors: { body: [expect.stringMatching(/Variação de texto inválida/)] } });
    const mail = await createTemplate({ campaignId: campA, channel: "email", name: `${TAG}-w3`, subject: "s", body: "texto" });
    expect(mail).toMatchObject({ ok: true, data: { warnings: [] } });
  });
});
