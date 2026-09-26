import "dotenv/config";
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.EVOLUTION_API_URL = "http://evolution.invalid";
process.env.EVOLUTION_API_KEY = "test-global-key";

import { prisma } from "@/lib/prisma";
import { purgeTestCampaigns } from "@/lib/test-utils/purge";
import { encrypt } from "@/lib/crypto/secret-box";
import { seed } from "../../../prisma/seed";
import { POST } from "@/app/api/webhooks/whatsapp/[token]/[[...evento]]/route";
import { _resetWebhookRateLimit, configureWebhookRateLimit } from "./webhook-rate-limit";

const TAG = "zz-spec012";
const TOKEN = randomBytes(32).toString("base64url");
const TOKEN2 = randomBytes(32).toString("base64url");
const INST_KEY = "instance-own-key";
const PHONE = "+5511988887777";
const JID = "5511988887777@s.whatsapp.net";
let instId = "";
let campId = "";
let stepId = "";
let seqN = 0;

const call = (token: string, body: unknown, evento?: string[]) =>
  POST(new Request(`http://app.test/api/webhooks/whatsapp/${token}${evento ? "/" + evento.join("/") : ""}`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }), {
    params: Promise.resolve({ token, evento }),
  });
const upsert = (text: string, over: Record<string, unknown> = {}, key: Record<string, unknown> = {}) => ({
  event: "messages.upsert", instance: TAG, data: { key: { id: `M${++seqN}${Date.now()}`, remoteJid: JID, fromMe: false, ...key }, pushName: "Joao da Silva", message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000), ...over },
});

async function mkLead(phone = PHONE, over: Record<string, unknown> = {}, stage: "novo_lead" | "contactado" | "em_followup" | "interessado" | "reuniao_agendada" | "fechado" | "perdido" = "contactado") {
  const lead = await prisma.lead.create({ data: { campaignId: campId, name: "Joao", phone, sequenceStatus: "active", ...over } });
  const opp = await prisma.opportunity.create({ data: { leadId: lead.id, campaignId: campId, stage } });
  const t = await prisma.touch.create({ data: { leadId: lead.id, channel: "whatsapp", stepId, status: "scheduled", scheduledAt: new Date(Date.now() + 86400000) } });
  return { lead, opp, touch: t };
}
const state = async (leadId: string) => {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, include: { opportunities: true, touches: true } });
  return { lead, opp: lead.opportunities[0], inbound: lead.touches.filter((t) => t.direction === "inbound"), pending: lead.touches.filter((t) => t.direction === "outbound") };
};
async function clean() {
  await prisma.suppression.deleteMany({ where: { leadId: { in: (await prisma.lead.findMany({ where: { campaignId: campId }, select: { id: true } })).map((l) => l.id) } } });
  await prisma.lead.deleteMany({ where: { campaignId: campId } });
  await prisma.webhookEvent.deleteMany({ where: { source: "whatsapp", eventId: { startsWith: `wa:${instId}:` } } });
}

beforeAll(async () => {
  await purgeTestCampaigns(TAG);
  await seed(prisma);
  const user = await prisma.user.findFirstOrThrow({ where: { email: "admin@leadforge.local" } });
  const icp = await prisma.icpProfile.findFirstOrThrow();
  const seq = await prisma.sequence.create({ data: { name: TAG, orgId: icp.orgId } });
  instId = (await prisma.whatsAppInstance.create({ data: { orgId: icp.orgId, instanceName: TAG, number: "+5511999990001", webhookToken: TOKEN, status: "connecting", apiKey: encrypt(INST_KEY) } })).id;
  campId = (await prisma.campaign.create({ data: { name: TAG, userId: user.id, icpId: icp.id, orgId: icp.orgId, sequenceId: seq.id, whatsappInstanceId: instId } })).id;
  const tpl = await prisma.messageTemplate.create({ data: { campaignId: campId, orgId: icp.orgId, channel: "whatsapp", name: TAG, body: "Oi" } });
  stepId = (await prisma.sequenceStep.create({ data: { sequenceId: seq.id, day: 0, channel: "whatsapp", templateId: tpl.id, order: 1 } })).id;
}, 30000);
afterAll(async () => {
  await purgeTestCampaigns(TAG).catch(() => {});
  await clean();
  await prisma.sequenceStep.deleteMany({ where: { id: stepId } });
  await prisma.campaign.deleteMany({ where: { id: campId } });
  await prisma.messageTemplate.deleteMany({ where: { name: TAG } });
  await prisma.sequence.deleteMany({ where: { name: TAG } });
  await prisma.whatsAppInstance.deleteMany({ where: { instanceName: TAG } });
  await prisma.$disconnect();
});
beforeEach(async () => {
  _resetWebhookRateLimit();
  await clean();
});
afterEach(() => vi.restoreAllMocks());

describe("autenticação e validação", () => {
  it("token inexistente, malformado ou errado -> 401 IDÊNTICO", async () => {
    const bodies: string[] = [];
    for (const t of ["token-invalido", TOKEN2, TOKEN.slice(0, -1) + (TOKEN.endsWith("A") ? "B" : "A"), "x".repeat(500)]) {
      const r = await call(t, upsert("oi"));
      expect(r.status).toBe(401);
      bodies.push(await r.text());
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toMatch(/Não autorizado/);
  });
  it("corpo inválido com token inválido -> 401 (não vaza validação)", async () => {
    expect((await call("token-invalido", "nao-json")).status).toBe(401);
  });
  it("2º fator: apikey errada no corpo -> 401; correta ou ausente -> ok", async () => {
    expect((await call(TOKEN, { ...upsert("oi"), apikey: "errada" })).status).toBe(401);
    expect((await call(TOKEN, { ...upsert("oi"), apikey: INST_KEY })).status).toBe(200);
    expect((await call(TOKEN, upsert("oi"))).status).toBe(200);
  });
  it("payload inválido -> 400 (json quebrado, envelope, dados)", async () => {
    expect((await call(TOKEN, "nao-json")).status).toBe(400);
    expect((await call(TOKEN, { foo: 1 })).status).toBe(400);
    expect((await call(TOKEN, { event: "messages.upsert", instance: TAG, data: { key: {} } })).status).toBe(400);
  });
  it("evento de outra instância com token válido -> 401", async () => {
    expect((await call(TOKEN, { ...upsert("oi"), instance: "outra" })).status).toBe(401);
  });
  it("sufixo de evento (webhook_by_events) é aceito", async () => {
    expect((await call(TOKEN, upsert("oi"), ["messages-upsert"])).status).toBe(200);
  });
});

describe("rate limit", () => {
  it("token válido acima do teto -> 429 + Retry-After PT-BR; invalidos não consomem a cota do válido", async () => {
    configureWebhookRateLimit({ tokenMax: 3, invalidMax: 2 });
    for (let i = 0; i < 3; i++) expect((await call(TOKEN, { event: "presence.update", instance: TAG, data: {} })).status).toBe(200);
    const r = await call(TOKEN, { event: "presence.update", instance: TAG, data: {} });
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect((await r.json()).message).toMatch(/Muitas requisições/);
    _resetWebhookRateLimit();
    configureWebhookRateLimit({ invalidMax: 2 });
    expect((await call("token-invalido", {})).status).toBe(401);
    expect((await call("token-invalido", {})).status).toBe(401);
    const r2 = await call("token-invalido", {});
    expect(r2.status).toBe(429);
    expect(r2.headers.get("Retry-After")).toBeTruthy();
    expect((await call(TOKEN, upsert("oi"))).status).toBe(200);
  });
  it("teto global -> 429", async () => {
    configureWebhookRateLimit({ globalMax: 1 });
    expect((await call(TOKEN, { event: "x", instance: TAG, data: {} })).status).toBe(200);
    expect((await call(TOKEN, { event: "x", instance: TAG, data: {} })).status).toBe(429);
  });
  it("corpo chunked grande SEM content-length -> 413 (teto real de bytes) e o stream é cancelado", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) { if (++pulled > 50) c.close(); else c.enqueue(new Uint8Array(100_000)); },
    });
    const req = new Request(`http://app.test/api/webhooks/whatsapp/${TOKEN}`, { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect(req.headers.get("content-length")).toBeNull();
    const r = await POST(req, { params: Promise.resolve({ token: TOKEN, evento: undefined }) });
    expect(r.status).toBe(413);
    expect(pulled).toBeLessThan(20);
  });
  it("token forjado não cria chave por token", async () => {
    const { _webhookRateLimitSize } = await import("./webhook-rate-limit");
    for (let i = 0; i < 20; i++) await call(randomBytes(32).toString("base64url"), {});
    expect(_webhookRateLimitSize()).toBe(1); // só o balde "invalid"
  });
});

describe("MESSAGES_UPSERT: resposta (D4)", () => {
  it("payload de exemplo do PROMPT (sem key.id): pausa sequência, cria Touch inbound, move para interessado", async () => {
    const { lead, touch } = await mkLead();
    const prompt = { event: "messages.upsert", instance: TAG, data: { key: { remoteJid: JID, fromMe: false }, pushName: "Joao da Silva", message: { conversation: "Ola, tenho interesse!" } } };
    const r = await call(TOKEN, prompt);
    expect(r.status).toBe(200);
    const s = await state(lead.id);
    expect(s.lead.sequenceStatus).toBe("paused_replied");
    expect(s.lead.repliedAt).not.toBeNull();
    expect(s.lead.nextTouchAt).toBeNull();
    expect(s.inbound).toHaveLength(1);
    expect(s.inbound[0]).toMatchObject({ direction: "inbound", channel: "whatsapp", content: "Ola, tenho interesse!", whatsappInstanceId: instId });
    expect(s.opp.stage).toBe("interessado");
    expect((await prisma.touch.findUniqueOrThrow({ where: { id: touch.id } })).status).toBe("skipped");
    const hist = await prisma.stageHistory.findMany({ where: { opportunityId: s.opp.id } });
    expect(hist.map((h) => h.toStage)).toContain("interessado");
  });
  it("idempotência: mesmo evento 2x não duplica", async () => {
    const { lead } = await mkLead();
    const body = upsert("Tenho interesse");
    expect((await call(TOKEN, body)).status).toBe(200);
    const again = await call(TOKEN, body);
    expect(again.status).toBe(200);
    expect((await again.json()).result).toBe("duplicate");
    expect((await state(lead.id)).inbound).toHaveLength(1);
  });
  it("fromMe e grupos são ignorados", async () => {
    const { lead } = await mkLead();
    expect((await call(TOKEN, upsert("oi", {}, { fromMe: true }))).status).toBe(200);
    expect((await call(TOKEN, upsert("oi", {}, { remoteJid: "120363@g.us" }))).status).toBe(200);
    const s = await state(lead.id);
    expect(s.inbound).toHaveLength(0);
    expect(s.lead.sequenceStatus).toBe("active");
  });
  it("lead inexistente -> 200 e log sem PII", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const r = await call(TOKEN, upsert("oi", {}, { remoteJid: "5511977776666@s.whatsapp.net" }));
    expect(r.status).toBe(200);
    expect((await r.json()).result).toBe("lead_not_found");
    const out = spy.mock.calls.flat().join(" ");
    expect(out).toMatch(/lead não encontrado/);
    expect(out).not.toMatch(/977776666|Joao/);
  });
  it.each(["interessado", "reuniao_agendada", "fechado"] as const)("não regride estágio %s", async (stage) => {
    const { lead } = await mkLead(PHONE, {}, stage);
    await call(TOKEN, upsert("Tenho interesse"));
    const s = await state(lead.id);
    expect(s.opp.stage).toBe(stage);
    expect(s.lead.sequenceStatus).toBe("paused_replied");
    expect(s.inbound).toHaveLength(1);
  });
  it("perdido: só registra a resposta (não reabre)", async () => {
    const { lead } = await mkLead(PHONE, { sequenceStatus: "completed" }, "perdido");
    await call(TOKEN, upsert("Agora tenho interesse"));
    const s = await state(lead.id);
    expect(s.opp.stage).toBe("perdido");
    expect(s.inbound).toHaveLength(1);
    expect(s.lead.repliedAt).not.toBeNull();
    expect(s.lead.sequenceStatus).toBe("completed");
  });
  it("opted_out é preservado (registra a resposta, sem reativar)", async () => {
    const { lead } = await mkLead(PHONE, { sequenceStatus: "opted_out", optedOutAt: new Date() }, "perdido");
    await call(TOKEN, upsert("Ola de novo"));
    const s = await state(lead.id);
    expect(s.lead.sequenceStatus).toBe("opted_out");
    expect(s.inbound).toHaveLength(1);
  });
  it("mesmo telefone em 2 campanhas: escolhe o lead da instância/sequência ativa", async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { email: "admin@leadforge.local" } });
    const icp = await prisma.icpProfile.findFirstOrThrow();
    const seq = await prisma.sequence.findFirstOrThrow({ where: { name: TAG } });
    const other = await prisma.campaign.create({ data: { name: `${TAG}-b`, userId: user.id, icpId: icp.id, orgId: icp.orgId, sequenceId: seq.id } });
    try {
      const outro = await prisma.lead.create({ data: { campaignId: other.id, name: "X", phone: PHONE, sequenceStatus: "active" } });
      const { lead } = await mkLead();
      await call(TOKEN, upsert("oi"));
      expect((await state(lead.id)).inbound).toHaveLength(1);
      expect((await state(outro.id)).inbound).toHaveLength(0);
    } finally {
      await prisma.campaign.delete({ where: { id: other.id } });
    }
  });
});

describe("opt-out (D18)", () => {
  it.each(["PARAR", "Não quero", "  Sair! ", "stop 🙏", "Não tenho interesse"])("%j -> opted_out + perdido", async (text) => {
    const { lead, touch } = await mkLead();
    await call(TOKEN, upsert(text));
    const s = await state(lead.id);
    expect(s.lead.sequenceStatus).toBe("opted_out");
    expect(s.lead.optedOutAt).not.toBeNull();
    expect(s.opp).toMatchObject({ stage: "perdido", lostReason: "Opt-out por WhatsApp" });
    expect((await prisma.touch.findUniqueOrThrow({ where: { id: touch.id } })).status).toBe("skipped");
    expect(s.inbound).toHaveLength(1);
  });
  it("frase longa não é opt-out: resposta normal", async () => {
    const { lead } = await mkLead();
    await call(TOKEN, upsert("nao quero parar de conversar"));
    const s = await state(lead.id);
    expect(s.lead.sequenceStatus).toBe("paused_replied");
    expect(s.lead.possibleOptOut).toBe(false);
    expect(s.opp.stage).toBe("interessado");
  });
  it("possível opt-out: marca alerta, pausa, NÃO move para perdido nem avança", async () => {
    const { lead, touch } = await mkLead();
    await call(TOKEN, upsert("Por favor, para de me mandar mensagem"));
    const s = await state(lead.id);
    expect(s.lead.possibleOptOut).toBe(true);
    expect(s.lead.sequenceStatus).toBe("paused_replied");
    expect(s.opp.stage).toBe("contactado");
    expect((await prisma.touch.findUniqueOrThrow({ where: { id: touch.id } })).status).toBe("skipped");
  });
});

describe("MESSAGES_UPDATE / CONNECTION_UPDATE / QRCODE_UPDATED", () => {
  it("message_status: delivered avança sent; idempotente; nunca regride", async () => {
    const { lead } = await mkLead();
    const t = await prisma.touch.create({ data: { leadId: lead.id, channel: "whatsapp", status: "sent", externalId: "OUT1", whatsappInstanceId: instId, sentAt: new Date() } });
    const body = { event: "messages.update", instance: TAG, data: { keyId: "OUT1", status: "DELIVERY_ACK" } };
    expect((await call(TOKEN, body)).status).toBe(200);
    expect((await prisma.touch.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("delivered");
    expect((await (await call(TOKEN, body)).json()).result).toBe("duplicate");
    await call(TOKEN, { ...body, data: { keyId: "OUT1", status: "ERROR" } });
    expect((await prisma.touch.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("delivered");
  });
  it("connection.update atualiza WaStatus e lastConnectedAt; qrcode.updated -> connecting", async () => {
    await prisma.whatsAppInstance.update({ where: { id: instId }, data: { status: "connecting", lastConnectedAt: null } });
    await call(TOKEN, { event: "connection.update", instance: TAG, data: { state: "open" } });
    let i = await prisma.whatsAppInstance.findUniqueOrThrow({ where: { id: instId } });
    expect(i.status).toBe("connected");
    expect(i.lastConnectedAt).not.toBeNull();
    await call(TOKEN, { event: "connection.update", instance: TAG, data: { state: "close" } });
    expect((await prisma.whatsAppInstance.findUniqueOrThrow({ where: { id: instId } })).status).toBe("disconnected");
    await call(TOKEN, { event: "qrcode.updated", instance: TAG, data: { qrcode: { base64: "QR" } } });
    i = await prisma.whatsAppInstance.findUniqueOrThrow({ where: { id: instId } });
    expect(i.status).toBe("connecting");
  });
});

describe("token nunca aparece em logs, erros ou WebhookEvent", () => {
  it("console.* e payloads salvos não contêm o token", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    await mkLead();
    await call(TOKEN, upsert("Ola, tenho interesse!"));
    await call(TOKEN, upsert("oi", {}, { remoteJid: "5511900000000@s.whatsapp.net" }));
    await call(TOKEN, "nao-json");
    await call(TOKEN2, upsert("oi"));
    await call("token-invalido", upsert("oi"));
    vi.spyOn(prisma.whatsAppInstance, "update").mockRejectedValueOnce(new Error(`falha em http://app.test/api/webhooks/whatsapp/${TOKEN}`));
    const r = await call(TOKEN, { event: "connection.update", instance: TAG, data: { state: "open" } });
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain(TOKEN);
    const logs = spies.flatMap((s) => s.mock.calls).flat().map((x) => (x instanceof Error ? x.message + x.stack : String(x))).join("\n");
    expect(logs).not.toContain(TOKEN);
    const events = await prisma.webhookEvent.findMany({ where: { source: "whatsapp", eventId: { startsWith: `wa:${instId}:` } } });
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain(TOKEN);
    expect(JSON.stringify(events)).not.toMatch(/Ola, tenho interesse|988887777/);
  });
});
