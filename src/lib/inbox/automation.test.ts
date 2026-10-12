import "dotenv/config";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");

import { prisma } from "@/lib/prisma";
import { sendWhatsApp } from "@/lib/channels/whatsapp";
import { FakeWhatsAppProvider } from "@/lib/whatsapp/providers/fake";
import { dropInboxOrg, mkConversation, mkInboxOrg, mkLeadIn, type InboxOrg } from "@/lib/test-utils/inbox-fixture";
import * as record from "@/lib/inbox/record";
import { manualReserve } from "./constants";

/** SPEC-068a: o envio automático espelha na caixa sem alterar o comportamento da 017 e deixa 20% do limite para respostas manuais. */
const IN_WINDOW = new Date("2026-06-10T13:30:00Z"); // quarta, 10:30 em SP
let A: InboxOrg;
let stepId = "";

async function mkTouch(leadId: string, over: Record<string, unknown> = {}) {
  return prisma.touch.create({ data: { leadId, channel: "whatsapp", stepId, status: "scheduled", ...over } });
}

beforeAll(async () => {
  A = await mkInboxOrg("aut");
  const seq = await prisma.sequence.create({ data: { name: "zz-inbox-aut", orgId: A.orgId } });
  const tpl = await prisma.messageTemplate.create({ data: { campaignId: A.campaignId, orgId: A.orgId, channel: "whatsapp", name: "zz-inbox-aut", body: "Olá {{firstName}}" } });
  stepId = (await prisma.sequenceStep.create({ data: { sequenceId: seq.id, day: 0, channel: "whatsapp", templateId: tpl.id, order: 1 } })).id;
}, 30000);
afterAll(async () => {
  await prisma.sequenceStep.deleteMany({ where: { id: stepId } });
  await dropInboxOrg(A);
  await prisma.sequence.deleteMany({ where: { name: "zz-inbox-aut" } });
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await prisma.waMessage.deleteMany({ where: { orgId: A.orgId } });
  await prisma.waConversation.deleteMany({ where: { orgId: A.orgId } });
  await prisma.touch.deleteMany({ where: { lead: { campaignId: A.campaignId } } });
  await prisma.whatsAppInstance.update({ where: { id: A.instanceId }, data: { dailyLimit: 30, status: "connected", health: "good", pausedUntil: null } });
});

describe("sendWhatsApp -> caixa", () => {
  it("grava WaMessage origin=automation ligada ao Touch; conversa sem resposta do lead", async () => {
    const lead = await mkLeadIn(A, { hasWhatsapp: true, name: "Ana" });
    const t = await mkTouch(lead.id);
    const r = await sendWhatsApp(t.id, { now: IN_WINDOW, provider: new FakeWhatsAppProvider() });
    expect(r.status).toBe("sent");
    const m = await prisma.waMessage.findFirstOrThrow({ where: { orgId: A.orgId } });
    expect(m).toMatchObject({ direction: "outbound", origin: "automation", status: "sent", touchId: t.id, body: "Olá Ana", externalId: "fake-msg-1", orgId: A.orgId });
    const c = await prisma.waConversation.findFirstOrThrow({ where: { orgId: A.orgId } });
    expect(c).toMatchObject({ leadId: lead.id, lastInboundAt: null, lastMessageDirection: "outbound", unreadCount: 0 });
  });

  it("se o eco fromMe chegou primeiro (linha device), a linha é promovida a automation sem duplicar", async () => {
    const lead = await mkLeadIn(A, { hasWhatsapp: true, name: "Ana" });
    const conv = await mkConversation(A, { leadId: lead.id, phone: lead.phone!, lastInboundAt: null });
    await prisma.waMessage.create({ data: { orgId: A.orgId, conversationId: conv.id, whatsappInstanceId: A.instanceId, direction: "outbound", origin: "device", body: "Olá Ana", externalId: "fake-msg-1", status: "delivered", messageAt: IN_WINDOW } });
    const t = await mkTouch(lead.id);
    expect((await sendWhatsApp(t.id, { now: IN_WINDOW, provider: new FakeWhatsAppProvider() })).status).toBe("sent");
    const all = await prisma.waMessage.findMany({ where: { orgId: A.orgId } });
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ origin: "automation", touchId: t.id, status: "delivered" });
  });

  it("falha ao gravar a caixa NUNCA falha o envio nem reenvia (Touch fica sent)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(record, "recordAutomationMessage").mockRejectedValueOnce(new Error("boom com 5511999999999"));
    const lead = await mkLeadIn(A, { hasWhatsapp: true });
    const t = await mkTouch(lead.id);
    const fake = new FakeWhatsAppProvider();
    expect((await sendWhatsApp(t.id, { now: IN_WINDOW, provider: fake })).status).toBe("sent");
    expect((await prisma.touch.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("sent");
    expect(fake.sent).toHaveLength(1);
    expect((await sendWhatsApp(t.id, { now: IN_WINDOW, provider: fake })).status).toBe("already_sent");
    expect(fake.sent).toHaveLength(1);
    expect(spy.mock.calls.flat().join(" ")).not.toContain("5511999999999");
  });
});

describe("reserva de 20% para respostas manuais (D-068-5)", () => {
  it("manualReserve: 20% arredondado para baixo (limites pequenos do aquecimento não reservam)", () => {
    expect([0, 1, 2, 3, 10, 30].map(manualReserve)).toEqual([0, 0, 0, 0, 2, 6]);
  });

  async function seedSent(n: number) {
    for (let i = 0; i < n; i++) {
      const l = await mkLeadIn(A, { hasWhatsapp: true });
      await prisma.touch.create({ data: { leadId: l.id, channel: "whatsapp", status: "sent", sentAt: new Date("2026-06-10T05:00:00Z"), whatsappInstanceId: A.instanceId } });
    }
  }
  const trySend = async () => {
    const lead = await mkLeadIn(A, { hasWhatsapp: true });
    return sendWhatsApp((await mkTouch(lead.id)).id, { now: IN_WINDOW, provider: new FakeWhatsAppProvider() });
  };

  it("com dailyLimit 10, o automático para em 8 (reserva 2)", async () => {
    await prisma.whatsAppInstance.update({ where: { id: A.instanceId }, data: { dailyLimit: 10 } });
    await seedSent(7);
    expect((await trySend()).status).toBe("sent"); // 8º
    expect(await trySend()).toMatchObject({ status: "deferred", reason: "daily_limit" }); // 9º cai na reserva
  });

  it("e nunca passa do teto somando as respostas manuais do dia", async () => {
    await prisma.whatsAppInstance.update({ where: { id: A.instanceId }, data: { dailyLimit: 10 } });
    await seedSent(4);
    const lead = await mkLeadIn(A);
    const conv = await mkConversation(A, { leadId: lead.id, phone: lead.phone!, lastInboundAt: IN_WINDOW });
    await prisma.waMessage.createMany({ data: Array.from({ length: 6 }, (_, i) => ({ orgId: A.orgId, conversationId: conv.id, whatsappInstanceId: A.instanceId, direction: "outbound" as const, origin: "manual" as const, body: "r", status: "sent" as const, messageAt: new Date(`2026-06-10T0${6 + (i % 3)}:00:00Z`) })) });
    expect(await trySend()).toMatchObject({ status: "deferred", reason: "daily_limit" }); // 4 auto + 6 manual = 10
  });

  it("espaçamento de 3 s também entre uma resposta manual e o automático", async () => {
    const lead = await mkLeadIn(A);
    const conv = await mkConversation(A, { leadId: lead.id, phone: lead.phone!, lastInboundAt: IN_WINDOW });
    await prisma.waMessage.create({ data: { orgId: A.orgId, conversationId: conv.id, whatsappInstanceId: A.instanceId, direction: "outbound", origin: "manual", body: "r", status: "sent", messageAt: new Date(IN_WINDOW.getTime() - 1000) } });
    expect(await trySend()).toMatchObject({ status: "deferred", reason: "min_interval" });
  });
});
