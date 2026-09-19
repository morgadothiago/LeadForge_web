import "dotenv/config";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { seed } from "../../../prisma/seed";
import { purgeTestCampaigns } from "@/lib/test-utils/purge";
import * as route from "@/app/api/integrations/leads/route";
import { _resetIngestRateLimit, AUDIT_SOURCE, readBodyLimited } from "./handler";
import { getIngestSecret, isIngestEnabled } from "./config";
import { runTick } from "@/lib/scheduler/run-tick";

const TAG = "zz-test-spec014";
const SECRET = "i".repeat(16) + "INGEST-segredo-de-teste-123456";
const URL_ = "http://localhost:3000/api/integrations/leads";
let campaignId = "";
let seqId = "";
let n = 0;

const post = (body: unknown, opts: { auth?: string | null; key?: string; raw?: BodyInit } = {}) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const auth = opts.auth === undefined ? `Bearer ${SECRET}` : opts.auth;
  if (auth) headers.authorization = auth;
  if (opts.key) headers["idempotency-key"] = opts.key;
  return route.POST(new Request(URL_, { method: "POST", headers, body: opts.raw ?? JSON.stringify(body) }));
};
const uniq = () => ++n;
const lead = (over: Record<string, unknown> = {}) => {
  const k = uniq();
  return { name: `Ana ${k}`, email: `ana${k}@${TAG}.com`, ...over };
};
const snap = async (r: Response) => ({ status: r.status, body: await r.text(), headers: [...r.headers.entries()].sort() });

async function cleanup() {
  await prisma.webhookEvent.deleteMany({ where: { source: AUDIT_SOURCE } });
  await prisma.suppression.deleteMany({ where: { value: { contains: TAG } } });
  await purgeTestCampaigns(TAG);
  await prisma.sequence.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await seed(prisma);
  await cleanup();
  const userId = (await prisma.user.findFirstOrThrow({ where: { email: "admin@leadforge.local" } })).id;
  const icpId = (await prisma.icpProfile.findFirstOrThrow()).id;
  const seq = await prisma.sequence.create({ data: { name: `${TAG}-seq` } });
  seqId = seq.id;
  const tpl = await prisma.campaign.create({ data: { name: `${TAG}-c`, userId, icpId, sequenceId: seq.id } });
  campaignId = tpl.id;
}, 30000);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});
beforeEach(() => {
  _resetIngestRateLimit();
  process.env.INGEST_SECRET = SECRET;
  process.env.INTEGRATION_LEADS_ENABLED = "true";
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.INGEST_SECRET;
  delete process.env.INTEGRATION_LEADS_ENABLED;
});

describe("config e autenticação", () => {
  it("flag exatamente 'true' e segredo 32+", () => {
    expect(isIngestEnabled({})).toBe(false);
    expect(isIngestEnabled({ INTEGRATION_LEADS_ENABLED: "TRUE" })).toBe(false);
    expect(isIngestEnabled({ INTEGRATION_LEADS_ENABLED: "1" })).toBe(false);
    expect(isIngestEnabled({ INTEGRATION_LEADS_ENABLED: "true" })).toBe(true);
    expect(getIngestSecret({ INGEST_SECRET: "x".repeat(31) })).toBeNull();
    expect(getIngestSecret({ INGEST_SECRET: "x".repeat(32) })).toBe("x".repeat(32));
  });
  it("503 sem segredo, segredo curto ou sem flag (mesmo com Authorization)", async () => {
    delete process.env.INGEST_SECRET;
    expect((await post({}, { auth: "Bearer qualquer" })).status).toBe(503);
    process.env.INGEST_SECRET = "curto";
    expect((await post({}, { auth: "Bearer curto" })).status).toBe(503);
    process.env.INGEST_SECRET = SECRET;
    process.env.INTEGRATION_LEADS_ENABLED = "yes";
    expect((await post({ campaignId, leads: [lead()] })).status).toBe(503);
    delete process.env.INTEGRATION_LEADS_ENABLED;
    expect((await post({ campaignId, leads: [lead()] })).status).toBe(503);
  });
  it("401 idêntico sem header, malformado e errado; nada é criado", async () => {
    const before = await prisma.lead.count({ where: { campaignId } });
    const body = { campaignId, leads: [lead()] };
    const a = await snap(await post(body, { auth: null }));
    const b = await snap(await post(body, { auth: "Bearer errado" }));
    const c = await snap(await post(body, { auth: SECRET }));
    expect(a.status).toBe(401);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(a.body).not.toContain(SECRET);
    expect(await prisma.lead.count({ where: { campaignId } })).toBe(before);
  });
  it("405 nos demais métodos (sem autenticar)", async () => {
    for (const m of ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "DELETE"] as const) {
      const r = await (route[m] as () => Promise<Response>)();
      expect(r.status, m).toBe(405);
      expect(r.headers.get("allow")).toBe("POST");
    }
  });
  it("429 + Retry-After após excesso de tentativas inválidas; credencial válida segue passando", async () => {
    let last: Response | null = null;
    for (let i = 0; i < 25; i++) last = await post({}, { auth: `Bearer forjado-${i}` });
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect((await post({ campaignId, leads: [lead()] })).status).toBe(200);
  });
  it("429 para credencial válida acima do teto por minuto", async () => {
    const empty = { campaignId, leads: [] as unknown[] };
    let status = 0;
    let ra: string | null = null;
    for (let i = 0; i < 601; i++) {
      const r = await post(empty);
      status = r.status;
      ra = r.headers.get("retry-after");
    }
    expect(status).toBe(429);
    expect(Number(ra)).toBeGreaterThanOrEqual(1);
  }, 30000);
});

describe("corpo", () => {
  it("413 com corpo chunked (sem content-length) > 1 MB", async () => {
    const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent >= 20) return c.close();
        sent++;
        c.enqueue(chunk);
      },
    });
    const req = new Request(URL_, { method: "POST", headers: { authorization: `Bearer ${SECRET}` }, body: stream, duplex: "half" } as RequestInit);
    expect(req.headers.get("content-length")).toBeNull();
    const r = await route.POST(req);
    expect(r.status).toBe(413);
    expect(sent).toBeLessThan(20); // parou de ler ao estourar o teto
  });
  it("413 por content-length declarado grande; readBodyLimited respeita o teto", async () => {
    const r = await route.POST(new Request(URL_, { method: "POST", headers: { authorization: `Bearer ${SECRET}`, "content-length": String(2 * 1024 * 1024) }, body: "{}" }));
    expect(r.status).toBe(413);
    expect(await readBodyLimited(new Request(URL_, { method: "POST", body: "abcdef" }), 5)).toBeNull();
    expect(await readBodyLimited(new Request(URL_, { method: "POST", body: "abcde" }), 5)).toBe("abcde");
  });
  it("400 PT-BR: JSON inválido, sem campaignId, leads vazio/ausente/>100, Idempotency-Key ruim", async () => {
    expect((await post(null, { raw: "{nao-json" })).status).toBe(400);
    for (const b of [null, [], "x", {}, { campaignId: "abc", leads: [lead()] }, { campaignId, leads: [] }, { campaignId }, { campaignId, leads: "x" }, { campaignId, leads: Array.from({ length: 101 }, lead) }]) {
      const r = await post(b);
      expect(r.status, JSON.stringify(b)?.slice(0, 40)).toBe(400);
      const j = await r.json();
      expect(j.message).toBe("Payload inválido.");
      expect(JSON.stringify(j.details)).toMatch(/inválid|Envie|lista|Corpo/);
    }
    expect((await post({ campaignId, leads: [lead()] }, { key: "chave inválida!" })).status).toBe(400);
  });
  it("404 campanha inexistente; nada criado, nada de WebhookEvent", async () => {
    const before = await prisma.webhookEvent.count({ where: { source: AUDIT_SOURCE } });
    const r = await post({ campaignId: "11111111-1111-4111-8111-111111111111", leads: [lead()] }, { key: `${TAG}-nocamp` });
    expect(r.status).toBe(404);
    expect(await prisma.webhookEvent.count({ where: { source: AUDIT_SOURCE } })).toBe(before);
    // a chave não fica "queimada": mesma chave com campanha válida funciona
    expect((await post({ campaignId, leads: [lead()] }, { key: `${TAG}-nocamp` })).status).toBe(200);
  });
});

describe("criação em lote", () => {
  it("resultado por item: created/duplicate/suppressed/invalid; um inválido não derruba os outros", async () => {
    const dupEmail = `dup@${TAG}.com`;
    await post({ campaignId, leads: [{ name: "Existente", email: dupEmail }] });
    const supEmail = `sup@${TAG}.com`;
    await prisma.suppression.create({ data: { kind: "email", value: supEmail, reason: "manual" } });
    const r = await post({
      campaignId,
      leads: [
        lead({ phone: "(11) 91234-5678", tags: [" VIP ", "vip", "b2b"], company: "ACME", externalId: "x-1", source: "n8n" }),
        { name: "Duplicado", email: dupEmail.toUpperCase() },
        { name: "Suprimido", email: supEmail },
        { name: "", email: "x@y.com" },
        { name: "Sem contato" },
        { name: "Tel ruim", phone: "123" },
        { name: "Seed", email: `seed@${TAG}.com`, source: "SEED" },
        "texto solto",
        lead(),
      ],
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.results.map((x: { status: string }) => x.status)).toEqual(["created", "duplicate", "suppressed", "invalid", "invalid", "invalid", "invalid", "invalid", "created"]);
    expect(j).toMatchObject({ total: 9, created: 2, duplicate: 1, suppressed: 1, invalid: 5 });
    expect(j.results[3].reason).toContain("Nome");
    expect(j.results[6].reason).toContain("seed");
    const l = await prisma.lead.findUniqueOrThrow({ where: { id: j.results[0].leadId } });
    expect(l).toMatchObject({ phone: "+5511912345678", tags: ["vip", "b2b"], source: "n8n", sequenceStatus: "not_started", company: "ACME", rawData: { externalId: "x-1" } });
    expect(await prisma.lead.count({ where: { campaignId, email: supEmail } })).toBe(0);
    expect(await prisma.lead.count({ where: { campaignId, source: "seed" } })).toBe(0);
  });
  it("cria Opportunity novo_lead + StageHistory; source padrão 'integration'", async () => {
    const j = await (await post({ campaignId, leads: [lead()] })).json();
    const id = j.results[0].leadId as string;
    const l = await prisma.lead.findUniqueOrThrow({ where: { id }, include: { opportunities: { include: { stageHistory: true } } } });
    expect(l.source).toBe("integration");
    expect(l.opportunities).toHaveLength(1);
    expect(l.opportunities[0].stage).toBe("novo_lead");
    expect(l.opportunities[0].stageHistory).toHaveLength(1);
    expect(l.opportunities[0].stageHistory[0]).toMatchObject({ fromStage: null, toStage: "novo_lead" });
  });
  it("dedupe por e-mail e por telefone (inclusive dentro do mesmo lote e entre chamadas)", async () => {
    const k = uniq();
    const email = `d${k}@${TAG}.com`;
    const j = await (await post({ campaignId, leads: [{ name: "A", email, phone: "11981110001" }, { name: "B", email }, { name: "C", phone: "+55 (11) 98111-0001" }, { name: "D", email: `o${k}@${TAG}.com`, phone: "11981110001" }] })).json();
    expect(j.results.map((x: { status: string }) => x.status)).toEqual(["created", "duplicate", "duplicate", "duplicate"]);
    const j2 = await (await post({ campaignId, leads: [{ name: "A", email }] })).json();
    expect(j2.results[0].status).toBe("duplicate");
    await prisma.lead.deleteMany({ where: { campaignId, phone: "+5511981110001" } });
  });
  it("o mesmo contato pode existir em outra campanha", async () => {
    const userId = (await prisma.user.findFirstOrThrow({ where: { email: "admin@leadforge.local" } })).id;
    const icpId = (await prisma.icpProfile.findFirstOrThrow()).id;
    const c2 = await prisma.campaign.create({ data: { name: `${TAG}-c2`, userId, icpId } });
    const email = `multi@${TAG}.com`;
    expect((await (await post({ campaignId, leads: [{ name: "M", email }] })).json()).created).toBe(1);
    expect((await (await post({ campaignId: c2.id, leads: [{ name: "M", email }] })).json()).created).toBe(1);
  });
});

describe("Idempotency-Key", () => {
  it("repetição devolve o mesmo resultado sem recriar; corpo diferente => 422", async () => {
    const body = { campaignId, leads: [lead(), lead()] };
    const key = `${TAG}-idem-1`;
    const a = await (await post(body, { key })).json();
    const count = await prisma.lead.count({ where: { campaignId } });
    const bRes = await post(body, { key });
    const b = await bRes.json();
    expect(bRes.status).toBe(200);
    expect(b.results).toEqual(a.results);
    expect(b.created).toBe(2);
    expect(await prisma.lead.count({ where: { campaignId } })).toBe(count);
    expect((await post({ campaignId, leads: [lead()] }, { key })).status).toBe(422);
    expect(await prisma.webhookEvent.count({ where: { source: AUDIT_SOURCE, eventId: { not: null } } })).toBeGreaterThan(0);
  });
  it("chave em processamento => 409", async () => {
    const { createHash } = await import("node:crypto");
    const key = `${TAG}-idem-busy`;
    await prisma.webhookEvent.create({ data: { source: AUDIT_SOURCE, eventId: `lead_ingest:${createHash("sha256").update(key).digest("hex")}`, payload: { state: "processing" } } });
    const r = await post({ campaignId, leads: [lead()] }, { key });
    expect(r.status).toBe(409);
    expect(r.headers.get("retry-after")).toBe("1");
  });
});

describe("privacidade e segurança operacional", () => {
  it("WebhookEvent e console sem PII/segredo", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const email = `pii-secreto@${TAG}.com`;
    await post({ campaignId, leads: [{ name: "Fulano PIIzento", email, phone: "11977776666", company: "Empresa PII", website: "https://pii.example", externalId: "ext-pii" }, { name: "Erro", email: "não-é-email" }] }, { key: `${TAG}-pii` });
    await post({}, { auth: "Bearer errado-secreto" });
    const events = JSON.stringify(await prisma.webhookEvent.findMany({ where: { source: AUDIT_SOURCE } }));
    const logs = JSON.stringify([info, errSpy, warn, log].map((s) => s.mock.calls));
    for (const pii of ["Fulano", email, "977776666", "Empresa PII", "pii.example", "ext-pii", SECRET, "errado-secreto"]) {
      expect(events, pii).not.toContain(pii);
      expect(logs, pii).not.toContain(pii);
    }
    expect(logs).toContain("criados=1");
    await prisma.lead.deleteMany({ where: { campaignId, email } });
  });
  it("erro interno => 500 genérico, sem detalhe, e a chave é liberada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const spy = vi.spyOn(prisma.campaign, "findUnique").mockRejectedValueOnce(new Error("senha=postgres://u:p@host/db"));
    const r = await post({ campaignId, leads: [lead()] }, { key: `${TAG}-500` });
    expect(r.status).toBe(500);
    const t = await r.text();
    expect(t).not.toContain("postgres");
    spy.mockRestore();
    expect((await post({ campaignId, leads: [lead()] }, { key: `${TAG}-500` })).status).toBe(200);
  });
});

describe("integração com o scheduler", () => {
  it("lead ingerido nasce not_started e o tick NÃO o inicia nem envia (autoStart=false)", async () => {
    const j = await (await post({ campaignId, leads: [lead()] })).json();
    const id = j.results[0].leadId as string;
    const sendEmail = vi.fn(async () => ({}) as never);
    const sendWhatsApp = vi.fn(async () => ({}) as never);
    await runTick(new Date(), { campaignIds: [campaignId], sendEmail, sendWhatsApp, evaluateHealth: async () => 0 } as never);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendWhatsApp).not.toHaveBeenCalled();
    const l = await prisma.lead.findUniqueOrThrow({ where: { id } });
    expect(l.sequenceStatus).toBe("not_started");
    expect(await prisma.touch.count({ where: { leadId: id } })).toBe(0);
    await prisma.schedulerRun.deleteMany({ where: { startedAt: { gte: new Date(Date.now() - 60_000) } } });
    expect(seqId).toBeTruthy();
  });
});
