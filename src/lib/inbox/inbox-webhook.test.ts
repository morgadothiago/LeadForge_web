import "dotenv/config";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.EVOLUTION_API_URL = "http://evolution.invalid";
process.env.EVOLUTION_API_KEY = "test-global-key";

import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/webhooks/whatsapp/[token]/[[...evento]]/route";
import { _resetWebhookRateLimit } from "@/lib/whatsapp/webhook-rate-limit";
import { dropInboxOrg, mkConversation, mkInboxOrg, mkLeadIn, uniquePhone, updateBody, upsertBody, type InboxOrg } from "@/lib/test-utils/inbox-fixture";
import * as record from "@/lib/inbox/record";

/** SPEC-068a: dupla escrita do webhook (inbound), eco fromMe, status read/delivered, isolamento A/B e resiliência da caixa. */
let A: InboxOrg;
let B: InboxOrg;

const call = (org: InboxOrg, body: unknown) =>
  POST(new Request(`http://app.test/api/webhooks/whatsapp/${org.webhookToken}`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ token: org.webhookToken, evento: undefined }) });
const result = async (r: Response) => (await r.json()).result as string;

beforeAll(async () => {
  A = await mkInboxOrg("wha");
  B = await mkInboxOrg("whb");
}, 30000);
afterAll(async () => {
  await dropInboxOrg(A);
  await dropInboxOrg(B);
});
beforeEach(async () => {
  _resetWebhookRateLimit();
  vi.restoreAllMocks();
  for (const o of [A, B]) {
    await prisma.waMessage.deleteMany({ where: { orgId: o.orgId } });
    await prisma.waConversation.deleteMany({ where: { orgId: o.orgId } });
    await prisma.webhookEvent.deleteMany({ where: { orgId: o.orgId } });
  }
});

describe("webhook -> caixa (inbound)", () => {
  it("grava conversa + mensagem, não lida=1, waiting, e mantém o efeito de processInbound (pausa)", async () => {
    const lead = await mkLeadIn(A);
    const r = await call(A, upsertBody(A, lead.phone!, "Tenho interesse"));
    expect(await result(r)).toBe("reply");
    const conv = await prisma.waConversation.findFirstOrThrow({ where: { orgId: A.orgId }, include: { messages: true } });
    expect(conv).toMatchObject({ leadId: lead.id, contactPhone: lead.phone, status: "waiting", unreadCount: 1, lastMessagePreview: "Tenho interesse", lastMessageDirection: "inbound", whatsappInstanceId: A.instanceId });
    expect(conv.lastInboundAt).not.toBeNull();
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0]).toMatchObject({ direction: "inbound", origin: "lead", kind: "text", status: "delivered", body: "Tenho interesse", orgId: A.orgId });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).sequenceStatus).toBe("paused_replied");
    expect(await prisma.touch.count({ where: { leadId: lead.id, direction: "inbound" } })).toBe(1);
  });

  it("webhook reenviado não duplica mensagem nem incrementa não lidas", async () => {
    const lead = await mkLeadIn(A);
    const body = upsertBody(A, lead.phone!, "oi", { id: "DUP-1" });
    await call(A, body);
    expect(await result(await call(A, body))).toBe("duplicate");
    expect(await prisma.waMessage.count({ where: { orgId: A.orgId } })).toBe(1);
    expect((await prisma.waConversation.findFirstOrThrow({ where: { orgId: A.orgId } })).unreadCount).toBe(1);
  });

  it("segunda mensagem soma não lida e reabre conversa encerrada/atendendo como waiting", async () => {
    const lead = await mkLeadIn(A);
    await call(A, upsertBody(A, lead.phone!, "primeira"));
    await prisma.waConversation.updateMany({ where: { orgId: A.orgId }, data: { status: "closed", unreadCount: 0 } });
    await call(A, upsertBody(A, lead.phone!, "segunda"));
    expect(await prisma.waConversation.findFirstOrThrow({ where: { orgId: A.orgId } })).toMatchObject({ status: "waiting", unreadCount: 1, lastMessagePreview: "segunda" });
  });

  it("mensagem fora de ordem não regride a prévia da lista", async () => {
    const lead = await mkLeadIn(A);
    const now = Math.floor(Date.now() / 1000);
    await call(A, upsertBody(A, lead.phone!, "nova", { ts: now - 10 }));
    await call(A, upsertBody(A, lead.phone!, "antiga", { ts: now - 600 }));
    const c = await prisma.waConversation.findFirstOrThrow({ where: { orgId: A.orgId } });
    expect(c.lastMessagePreview).toBe("nova");
    expect(c.unreadCount).toBe(2);
  });

  it("opt-out continua funcionando e a mensagem entra na caixa", async () => {
    const lead = await mkLeadIn(A);
    await call(A, upsertBody(A, lead.phone!, "PARE"));
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).sequenceStatus).toBe("opted_out");
    expect(await prisma.waMessage.count({ where: { orgId: A.orgId, body: "PARE" } })).toBe(1);
  });

  it("falha de BANCO ao gravar a caixa NÃO impede pausa/opt-out (savepoint) e o webhook responde 200", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const lead = await mkLeadIn(A);
    vi.spyOn(record, "recordInboundMessage").mockImplementationOnce(async (db) => {
      await (db as typeof prisma).$executeRawUnsafe('SELECT * FROM "TabelaQueNaoExiste"'); // erro real do Postgres: aborta a transação sem o savepoint
      return "created";
    });
    const r = await call(A, upsertBody(A, lead.phone!, "PARE"));
    expect(r.status).toBe(200);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).sequenceStatus).toBe("opted_out");
    expect(await prisma.touch.count({ where: { leadId: lead.id, direction: "inbound" } })).toBe(1);
    expect(await prisma.waMessage.count({ where: { orgId: A.orgId } })).toBe(0);
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).not.toContain(lead.phone!);
    expect(logged).not.toContain("TabelaQueNaoExiste"); // só nome/código do erro, nunca `message` (B1)
  });

  it("lead inexistente: ignorado (sem conversa)", async () => {
    expect(await result(await call(A, upsertBody(A, uniquePhone(), "oi")))).toBe("lead_not_found");
    expect(await prisma.waConversation.count({ where: { orgId: A.orgId } })).toBe(0);
  });

  it("token inválido continua 401", async () => {
    const r = await POST(new Request("http://app.test/api/webhooks/whatsapp/x", { method: "POST", body: "{}" }), { params: Promise.resolve({ token: randomBytes(32).toString("base64url"), evento: undefined }) });
    expect(r.status).toBe(401);
  });

  it("grupo é ignorado", async () => {
    const lead = await mkLeadIn(A);
    const body = upsertBody(A, lead.phone!, "oi");
    (body.data.key as { remoteJid: string }).remoteJid = "1203630@g.us";
    await call(A, body);
    expect(await prisma.waMessage.count({ where: { orgId: A.orgId } })).toBe(0);
  });
});

describe("isolamento A/B no webhook", () => {
  it("mesmo telefone em duas orgs = duas conversas; webhook da instância A nunca grava na conversa B", async () => {
    const phone = uniquePhone();
    const la = await mkLeadIn(A, { phone });
    const lb = await mkLeadIn(B, { phone });
    await call(A, upsertBody(A, phone, "para A"));
    expect(await prisma.waConversation.count({ where: { orgId: B.orgId } })).toBe(0);
    await call(B, upsertBody(B, phone, "para B"));
    const ca = await prisma.waConversation.findFirstOrThrow({ where: { orgId: A.orgId }, include: { messages: true } });
    const cb = await prisma.waConversation.findFirstOrThrow({ where: { orgId: B.orgId }, include: { messages: true } });
    expect(ca.id).not.toBe(cb.id);
    expect([ca.leadId, cb.leadId]).toEqual([la.id, lb.id]);
    expect(ca.messages.map((m) => m.body)).toEqual(["para A"]);
    expect(cb.messages.map((m) => m.body)).toEqual(["para B"]);
    expect(ca.messages.every((m) => m.orgId === A.orgId)).toBe(true);
  });
});

describe("eco fromMe (outbound_echo)", () => {
  it("desconhecido vira origin=device/sent; reenvio do mesmo eco é idempotente", async () => {
    const lead = await mkLeadIn(A);
    const body = upsertBody(A, lead.phone!, "respondi pelo celular", { id: "ECHO-1", fromMe: true });
    expect(await result(await call(A, body))).toBe("echo_device");
    expect(await result(await call(A, body))).toBe("duplicate");
    const msgs = await prisma.waMessage.findMany({ where: { orgId: A.orgId } });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ direction: "outbound", origin: "device", status: "sent", externalId: "ECHO-1" });
    const conv = await prisma.waConversation.findFirstOrThrow({ where: { orgId: A.orgId } });
    expect(conv).toMatchObject({ status: "attending", unreadCount: 0, lastMessageDirection: "outbound" });
    // não é resposta de lead: sequência e Touch inbound intactos
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).sequenceStatus).toBe("active");
    expect(await prisma.touch.count({ where: { leadId: lead.id, direction: "inbound" } })).toBe(0);
  });

  it("externalId já conhecido (enviada pela API) só confirma: não duplica", async () => {
    const lead = await mkLeadIn(A);
    const conv = await mkConversation(A, { leadId: lead.id, phone: lead.phone!, lastInboundAt: new Date() });
    await prisma.waMessage.create({ data: { orgId: A.orgId, conversationId: conv.id, whatsappInstanceId: A.instanceId, direction: "outbound", origin: "manual", body: "oi", externalId: "API-1", status: "sent", messageAt: new Date() } });
    expect(await result(await call(A, upsertBody(A, lead.phone!, "oi", { id: "API-1", fromMe: true })))).toBe("echo_known");
    expect(await prisma.waMessage.count({ where: { orgId: A.orgId } })).toBe(1);
  });

  it("eco que chega ANTES do retorno do sendText adota a bolha `sending` (sem duplicar)", async () => {
    const lead = await mkLeadIn(A);
    const conv = await mkConversation(A, { leadId: lead.id, phone: lead.phone!, lastInboundAt: new Date() });
    const row = await prisma.waMessage.create({ data: { orgId: A.orgId, conversationId: conv.id, whatsappInstanceId: A.instanceId, direction: "outbound", origin: "manual", body: "olá!", clientMessageId: "11111111-1111-4111-8111-111111111111", status: "sending", messageAt: new Date() } });
    expect(await result(await call(A, upsertBody(A, lead.phone!, "olá!", { id: "EARLY-1", fromMe: true })))).toBe("echo_adopted");
    expect(await prisma.waMessage.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ externalId: "EARLY-1", status: "sent", origin: "manual" });
    expect(await prisma.waMessage.count({ where: { orgId: A.orgId } })).toBe(1);
  });

  it("timeout (failed, sem externalId) + eco posterior: adota e promove a sent, sem bolha device duplicada (M3)", async () => {
    const lead = await mkLeadIn(A);
    const conv = await mkConversation(A, { leadId: lead.id, phone: lead.phone!, lastInboundAt: new Date() });
    const row = await prisma.waMessage.create({ data: { orgId: A.orgId, conversationId: conv.id, whatsappInstanceId: A.instanceId, direction: "outbound", origin: "manual", body: "oi!", clientMessageId: "22222222-2222-4222-8222-222222222222", status: "failed", error: "Não foi possível confirmar o envio", messageAt: new Date() } });
    expect(await result(await call(A, upsertBody(A, lead.phone!, "oi!", { id: "LATE-1", fromMe: true })))).toBe("echo_adopted");
    expect(await prisma.waMessage.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ externalId: "LATE-1", status: "sent", error: null });
    expect(await prisma.waMessage.count({ where: { orgId: A.orgId } })).toBe(1);
  });

  it("eco de mensagem AUTOMÁTICA (Touch já existe) não promove waiting -> attending (B2)", async () => {
    const lead = await mkLeadIn(A);
    await mkConversation(A, { leadId: lead.id, phone: lead.phone!, lastInboundAt: null });
    await prisma.touch.create({ data: { leadId: lead.id, channel: "whatsapp", status: "sent", direction: "outbound", externalId: "AUTO-1", whatsappInstanceId: A.instanceId, sentAt: new Date() } });
    expect(await result(await call(A, upsertBody(A, lead.phone!, "msg automática", { id: "AUTO-1", fromMe: true })))).toBe("echo_device");
    expect((await prisma.waConversation.findFirstOrThrow({ where: { orgId: A.orgId } })).status).toBe("waiting");
  });

  it("eco chegou antes do Touch (marcou attending); ao gravar a automática a conversa volta a waiting (B2)", async () => {
    const lead = await mkLeadIn(A);
    await mkConversation(A, { leadId: lead.id, phone: lead.phone!, lastInboundAt: null });
    await call(A, upsertBody(A, lead.phone!, "auto", { id: "AUTO-2", fromMe: true }));
    expect((await prisma.waConversation.findFirstOrThrow({ where: { orgId: A.orgId } })).status).toBe("attending");
    await record.recordAutomationMessage(prisma, { id: A.instanceId, orgId: A.orgId }, { leadId: lead.id, phone: lead.phone!, touchId: (await prisma.touch.create({ data: { leadId: lead.id, channel: "whatsapp", status: "sent", direction: "outbound", externalId: "AUTO-2", whatsappInstanceId: A.instanceId } })).id, text: "auto", externalId: "AUTO-2", at: new Date() });
    expect((await prisma.waConversation.findFirstOrThrow({ where: { orgId: A.orgId } })).status).toBe("waiting");
    expect((await prisma.waMessage.findFirstOrThrow({ where: { orgId: A.orgId } })).origin).toBe("automation");
  });

  it("eco para número sem lead é ignorado", async () => {
    expect(await result(await call(A, upsertBody(A, uniquePhone(), "x", { fromMe: true })))).toBe("echo_lead_not_found");
    expect(await prisma.waMessage.count({ where: { orgId: A.orgId } })).toBe(0);
  });
});

describe("status de entrega em WaMessage", () => {
  it("sent < delivered < read; nunca regride; failed só a partir de sent", async () => {
    const lead = await mkLeadIn(A);
    const conv = await mkConversation(A, { leadId: lead.id, phone: lead.phone!, lastInboundAt: new Date() });
    const m = await prisma.waMessage.create({ data: { orgId: A.orgId, conversationId: conv.id, whatsappInstanceId: A.instanceId, direction: "outbound", origin: "manual", body: "x", externalId: "ST-1", status: "sending", messageAt: new Date() } });
    const status = async () => (await prisma.waMessage.findUniqueOrThrow({ where: { id: m.id } })).status;
    await call(A, updateBody(A, "ST-1", "SERVER_ACK"));
    expect(await status()).toBe("sent");
    await call(A, updateBody(A, "ST-1", "DELIVERY_ACK"));
    expect(await status()).toBe("delivered");
    await call(A, updateBody(A, "ST-1", "READ"));
    expect(await status()).toBe("read");
    await call(A, updateBody(A, "ST-1", "DELIVERY_ACK"));
    await call(A, updateBody(A, "ST-1", "SERVER_ACK"));
    await call(A, updateBody(A, "ST-1", "ERROR"));
    expect(await status()).toBe("read");
  });

  it("failed a partir de sent grava erro PT-BR; status de outra instância/org não afeta", async () => {
    const lead = await mkLeadIn(A);
    const conv = await mkConversation(A, { leadId: lead.id, phone: lead.phone!, lastInboundAt: new Date() });
    const m = await prisma.waMessage.create({ data: { orgId: A.orgId, conversationId: conv.id, whatsappInstanceId: A.instanceId, direction: "outbound", origin: "manual", body: "x", externalId: "ST-2", status: "sent", messageAt: new Date() } });
    await call(B, updateBody(B, "ST-2", "READ")); // mesma chave externa em outra instância: nada acontece
    expect((await prisma.waMessage.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("sent");
    await call(A, updateBody(A, "ST-2", "ERROR"));
    expect(await prisma.waMessage.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: "failed", error: "O WhatsApp reportou falha na entrega." });
  });
});
