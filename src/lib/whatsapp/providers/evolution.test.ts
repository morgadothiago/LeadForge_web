import { describe, expect, it } from "vitest";
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";
import { AppError } from "@/lib/errors";
import { EvolutionProvider, jidToE164 } from "./evolution";

const KEY = "super-secret-evo-key";
type Step = { status: number; headers?: Record<string, string>; data?: unknown } | { code: string };

function setup(steps: Step[], extra: { logs?: unknown[] } = {}) {
  const calls: InternalAxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = async (config) => {
    calls.push(config);
    const s = steps[Math.min(calls.length - 1, steps.length - 1)]!;
    if ("code" in s) throw new AxiosError(`boom ${KEY}`, s.code, config);
    const res = { data: s.data ?? {}, status: s.status, statusText: "", headers: s.headers ?? {}, config, request: {} };
    if (s.status < 300) return res;
    throw new AxiosError(`Request failed ${s.status} ${KEY}`, "ERR_BAD_RESPONSE", config, {}, res);
  };
  const p = new EvolutionProvider({
    baseURL: "http://evo.test", apiKey: KEY, adapter, rng: () => 0.5,
    retry: { sleep: async () => {}, random: () => 1 }, logger: (m, meta) => extra.logs?.push([m, meta]),
  });
  return { p, calls };
}
const fail = async (p: Promise<unknown>) => (await p.then(() => null, (e) => e)) as AppError;
const send = { instanceName: "leadforge-main", to: "+5511988887777", text: "Oi" };
const hook = (body: unknown, url = "http://app.test/api/webhooks/whatsapp", headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", body: JSON.stringify(body), headers });

describe("EvolutionProvider HTTP", () => {
  it("createInstance: payload do PROMPT (+ webhook/token) e apikey/hash", async () => {
    const { p, calls } = setup([{ status: 201, data: { instance: { instanceName: "x" }, hash: "inst-key", qrcode: { base64: "data:image/png;base64,AA" } } }]);
    const r = await p.createInstance({ instanceName: "leadforge-main", number: "+5511999999999", webhookUrl: "http://app.test/api/webhooks/whatsapp" });
    expect(r).toEqual({ apiKey: "inst-key", qrCode: "data:image/png;base64,AA" });
    const body = JSON.parse(calls[0].data);
    expect(calls[0].url).toBe("/instance/create");
    expect(calls[0].headers.get("apikey")).toBe(KEY);
    expect(body).toMatchObject({ instanceName: "leadforge-main", number: "5511999999999", integration: "WHATSAPP-BAILEYS", qrcode: true });
    expect(body.webhook.headers).toBeUndefined(); // auth = token no caminho da URL, não headers
    expect(body.webhook.events).toContain("MESSAGES_UPSERT");
  });
  it("hash como objeto {apikey}", async () => {
    const { p } = setup([{ status: 201, data: { hash: { apikey: "k2" } } }]);
    expect((await p.createInstance({ instanceName: "x", number: "+5511999999999", webhookUrl: "u" })).apiKey).toBe("k2");
  });
  it("getQr e getStatus mapeiam para tipos neutros", async () => {
    expect(await setup([{ status: 200, data: { base64: "QR", pairingCode: "ABCD" } }]).p.getQr("a")).toEqual({ qrCode: "QR", pairingCode: "ABCD" });
    expect(await setup([{ status: 200, data: { instance: { state: "open" } } }]).p.getStatus("a")).toEqual({ status: "connected" });
    expect(await setup([{ status: 200, data: { instance: { state: "close" } } }]).p.getStatus("a")).toEqual({ status: "disconnected" });
    expect(await setup([{ status: 200, data: { instance: { state: "connecting" } } }]).p.getStatus("a")).toEqual({ status: "connecting" });
  });
  it("sendText: sucesso, número sem +, delay 1200-3000", async () => {
    const { p, calls } = setup([{ status: 201, data: { key: { id: "ABC123" } } }]);
    expect(await p.sendText(send)).toEqual({ externalId: "ABC123" });
    const body = JSON.parse(calls[0].data);
    expect(calls[0].url).toBe("/message/sendText/leadforge-main");
    expect(body.number).toBe("5511988887777");
    expect(body.delay).toBeGreaterThanOrEqual(1200);
    expect(body.delay).toBeLessThanOrEqual(3000);
  });
  it("sendText: delay varia no intervalo com rng extremos", async () => {
    for (const [r, want] of [[0, 1200], [0.999999, 3000]] as const) {
      const calls: InternalAxiosRequestConfig[] = [];
      const adapter: AxiosAdapter = async (c) => (calls.push(c), { data: { key: { id: "i" } }, status: 200, statusText: "", headers: {}, config: c, request: {} });
      await new EvolutionProvider({ baseURL: "http://e", apiKey: KEY, adapter, rng: () => r }).sendText(send);
      expect(JSON.parse(calls[0].data).delay).toBe(want);
    }
  });
  it("4xx: nunca retryable, sem retry", async () => {
    const { p, calls } = setup([{ status: 400, data: { message: "x" } }]);
    const e = await fail(p.sendText(send));
    expect(e).toBeInstanceOf(AppError);
    expect(e.retryable).toBe(false);
    expect(e.code).toBe("validation");
    expect(calls).toHaveLength(1);
  });
  it("401 -> unauthorized", async () => expect((await fail(setup([{ status: 401 }]).p.getStatus("a"))).code).toBe("unauthorized"));
  it("429 com Retry-After no sendText: retryable + retryAfterSeconds, SEM retry automático", async () => {
    const { p, calls } = setup([{ status: 429, headers: { "retry-after": "7" } }, { status: 200, data: { key: { id: "i" } } }]);
    const e = await fail(p.sendText(send));
    expect(e).toMatchObject({ code: "rate_limited", retryable: true, retryAfterSeconds: 7 });
    expect(calls).toHaveLength(1);
  });
  it("5xx no sendText: retryable mas sem retry (POST)", async () => {
    const { p, calls } = setup([{ status: 503 }, { status: 200, data: { key: { id: "i" } } }]);
    const e = await fail(p.sendText(send));
    expect(e).toMatchObject({ code: "upstream", retryable: true });
    expect(calls).toHaveLength(1);
  });
  it("5xx em GET (idempotente) tenta de novo", async () => {
    const { p, calls } = setup([{ status: 503 }, { status: 200, data: { instance: { state: "open" } } }]);
    expect((await p.getStatus("a")).status).toBe("connected");
    expect(calls).toHaveLength(2);
  });
  it("timeout do sendText: erro timeout, uma única chamada", async () => {
    const { p, calls } = setup([{ code: "ECONNABORTED" }, { status: 200, data: { key: { id: "i" } } }]);
    const e = await fail(p.sendText(send));
    expect(e.code).toBe("timeout");
    expect(calls).toHaveLength(1);
  });
  it("resposta inválida (Zod) -> AppError upstream", async () => {
    const e = await fail(setup([{ status: 200, data: { foo: 1 } }]).p.sendText(send));
    expect(e).toMatchObject({ code: "upstream" });
    expect((await fail(setup([{ status: 200, data: {} }]).p.getStatus("a"))).code).toBe("upstream");
  });
  it("segredos ausentes das mensagens e dos logs", async () => {
    const logs: unknown[] = [];
    const { p } = setup([{ status: 503 }, { status: 503 }, { status: 503 }], { logs });
    const e = await fail(p.getStatus("a"));
    expect(e.userMessage).not.toContain(KEY);
    expect(e.message).not.toContain(KEY);
    expect(JSON.stringify(logs)).not.toContain(KEY);
    const t = await fail(setup([{ code: "ECONNABORTED" }]).p.sendText(send));
    expect(t.userMessage).not.toContain(KEY);
  });
});

describe("EvolutionProvider webhook", () => {
  const upsert = (data: Record<string, unknown>) => ({ event: "messages.upsert", instance: "leadforge-main", data });
  it("messages.upsert conversation (payload do PROMPT)", async () => {
    const r = await setup([]).p.parseWebhook(hook(upsert({ key: { id: "M1", remoteJid: "5511988887777@s.whatsapp.net", fromMe: false }, pushName: "Joao da Silva", message: { conversation: "Ola, tenho interesse!" }, messageTimestamp: 1781000000 })));
    expect(r).toMatchObject({ kind: "inbound", instanceName: "leadforge-main", from: "+5511988887777", pushName: "Joao da Silva", text: "Ola, tenho interesse!", externalId: "M1" });
    expect((r as { timestamp: Date }).timestamp.getTime()).toBe(1781000000_000);
  });
  it("extendedTextMessage.text e evento em MAIÚSCULAS", async () => {
    const r = await setup([]).p.parseWebhook(hook({ ...upsert({ key: { id: "M2", remoteJid: "5511988887777@s.whatsapp.net" }, message: { extendedTextMessage: { text: "oi" } } }), event: "MESSAGES_UPSERT" }));
    expect(r).toMatchObject({ kind: "inbound", text: "oi", pushName: null });
  });
  it("ignora fromMe, grupos, sem texto, JID não-BR e eventos desconhecidos", async () => {
    const { p } = setup([]);
    expect(await p.parseWebhook(hook(upsert({ key: { id: "1", remoteJid: "5511988887777@s.whatsapp.net", fromMe: true }, message: { conversation: "x" } })))).toBeNull();
    expect(await p.parseWebhook(hook(upsert({ key: { id: "1", remoteJid: "1203630@g.us" }, message: { conversation: "x" } })))).toBeNull();
    expect(await p.parseWebhook(hook(upsert({ key: { id: "1", remoteJid: "5511988887777@s.whatsapp.net" }, message: { imageMessage: {} } })))).toBeNull();
    expect(await p.parseWebhook(hook(upsert({ key: { id: "1", remoteJid: "14155550100@s.whatsapp.net" }, message: { conversation: "x" } })))).toBeNull();
    expect(await p.parseWebhook(hook({ event: "presence.update", instance: "a", data: {} }))).toBeNull();
  });
  it("normaliza JID legado sem o 9", () => {
    expect(jidToE164("551188887777@s.whatsapp.net")).toBe("+5511988887777");
    expect(jidToE164("5511988887777@s.whatsapp.net")).toBe("+5511988887777");
    expect(jidToE164("abc@g.us")).toBeNull();
  });
  it("connection.update, qrcode.updated, messages.update", async () => {
    const { p } = setup([]);
    expect(await p.parseWebhook(hook({ event: "connection.update", instance: "a", data: { state: "open" } }))).toEqual({ kind: "connection", instanceName: "a", status: "connected" });
    expect(await p.parseWebhook(hook({ event: "qrcode.updated", instance: "a", data: { qrcode: { base64: "QR" } } }))).toEqual({ kind: "qrcode", instanceName: "a", qrCode: "QR" });
    expect(await p.parseWebhook(hook({ event: "messages.update", instance: "a", data: { keyId: "K", status: "DELIVERY_ACK" } }))).toEqual({ kind: "message_status", instanceName: "a", externalId: "K", status: "delivered" });
    expect(await p.parseWebhook(hook({ event: "messages.update", instance: "a", data: { keyId: "K", status: "READ" } }))).toMatchObject({ status: "read" });
  });
  it("payload malformado -> AppError validation; request não é consumido", async () => {
    const { p } = setup([]);
    expect((await fail(p.parseWebhook(new Request("http://x", { method: "POST", body: "nao-json" })))).code).toBe("validation");
    expect((await fail(p.parseWebhook(hook({ event: "messages.upsert", instance: "a", data: { key: {} } })))).code).toBe("validation");
    const req = hook({ event: "connection.update", instance: "a", data: { state: "open" } });
    await p.parseWebhook(req);
    expect(req.bodyUsed).toBe(false);
  });
  it("verifyWebhook: token do caminho em tempo constante; rejeita errado/ausente/comprimento diferente", async () => {
    const { p } = setup([]);
    const inst = { webhookToken: "tok-abc-123" };
    const r = () => hook({ event: "connection.update", instance: "a", data: {} });
    expect(await p.verifyWebhook(r(), inst, "tok-abc-123")).toBe(true);
    expect(await p.verifyWebhook(r(), inst, "tok-abc-124")).toBe(false);
    expect(await p.verifyWebhook(r(), inst, "curto")).toBe(false);
    expect(await p.verifyWebhook(r(), inst, "")).toBe(false);
    expect(await p.verifyWebhook(r(), { webhookToken: "" }, "")).toBe(false);
    // header/query não autenticam mais
    expect(await p.verifyWebhook(hook({}, "http://a/b?token=tok-abc-123", { "x-webhook-token": "tok-abc-123" }), inst, "outro")).toBe(false);
  });
  it("verifyWebhook 2º fator: apikey no corpo confere com a da instância; ausente não reprova", async () => {
    const { p } = setup([]);
    const inst = { webhookToken: "tok", apiKey: "inst-key" };
    expect(await p.verifyWebhook(hook({ apikey: "inst-key" }), inst, "tok")).toBe(true);
    expect(await p.verifyWebhook(hook({ apikey: "outra" }), inst, "tok")).toBe(false);
    expect(await p.verifyWebhook(hook({ event: "x" }), inst, "tok")).toBe(true);
    expect(await p.verifyWebhook(new Request("http://x", { method: "POST", body: "nao-json" }), inst, "tok")).toBe(true);
    expect(await p.verifyWebhook(hook({ apikey: "qualquer" }), { webhookToken: "tok", apiKey: null }, "tok")).toBe(true);
    expect(await p.verifyWebhook(hook({ apikey: "outra" }), inst, "errado")).toBe(false);
  });
  it("configureWebhook: POST /webhook/set/{instância} com a URL por instância", async () => {
    const { p, calls } = setup([{ status: 200, data: {} }]);
    await p.configureWebhook({ instanceName: "leadforge main", webhookUrl: "http://app.test/api/webhooks/whatsapp/TOK" });
    expect(calls[0].url).toBe("/webhook/set/leadforge%20main");
    expect(JSON.parse(calls[0].data).webhook).toMatchObject({ enabled: true, url: "http://app.test/api/webhooks/whatsapp/TOK", byEvents: false });
  });
});
