import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { mkMeetingFixture, type MeetingFixture } from "@/lib/test-utils/meeting-fixture";
import { handleMeetingWebhook, _resetMeetingWebhookRateLimit } from "./webhook";
import { POST, GET } from "@/app/api/integrations/meetings/route";

const SECRET = "s".repeat(40);
const deps = { secret: SECRET, enabled: true };
let fx: MeetingFixture;
const startsIso = (h = 48) => new Date(Date.now() + h * 3600_000).toISOString(); // Z valido
const call = (body: unknown, token: string | null = SECRET, d: { secret: string | null; enabled: boolean } = deps) =>
  handleMeetingWebhook(new Request("http://x/api/integrations/meetings", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: typeof body === "string" ? body : JSON.stringify(body) }), d);

beforeAll(async () => {
  fx = await mkMeetingFixture("zz-test-mhook");
});
beforeEach(() => _resetMeetingWebhookRateLimit());
afterAll(async () => {
  await fx.cleanup();
  await prisma.$disconnect();
});

describe("POST /api/integrations/meetings", () => {
  it("sem chave/errada = 401 identico; desativado = 503", async () => {
    const a = await call({ leadId: fx.leadId, startsAt: startsIso() }, null);
    const b = await call({ leadId: fx.leadId, startsAt: startsIso() }, "errada");
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(await a.text()).toBe(await b.text());
    expect((await call({}, SECRET, { secret: SECRET, enabled: false })).status).toBe(503);
    expect((await call({}, SECRET, { secret: null, enabled: true })).status).toBe(503);
  });

  it("cria (201) por leadId, move stage, source=webhook; repeticao com externalId = 200 mesma reuniao", async () => {
    const body = { leadId: fx.leadId, startsAt: startsIso(), durationMin: 45, link: "https://meet.test/x", externalId: "ext-1" };
    const r1 = await call(body);
    expect(r1.status).toBe(201);
    const j1 = await r1.json();
    const m = await prisma.meeting.findUniqueOrThrow({ where: { id: j1.meetingId } });
    expect(m.source).toBe("webhook");
    expect(m.duration).toBe(45);
    expect(m.externalId).toBe("wh:ext-1");
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: fx.oppId } })).stage).toBe("reuniao_agendada");
    const r2 = await call(body);
    expect(r2.status).toBe(200);
    expect(await r2.json()).toMatchObject({ meetingId: j1.meetingId, idempotentReplay: true });
    expect(await prisma.meeting.count({ where: { externalId: "wh:ext-1" } })).toBe(1);
  });

  it("aceita offset explicito e resolve lead por telefone", async () => {
    const r = await call({ phone: "(11) 95555-0001", startsAt: "2099-05-01T14:00:00-03:00" });
    expect(r.status).toBe(201);
    const j = await r.json();
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: j.meetingId } })).startsAt.toISOString()).toBe("2099-05-01T17:00:00.000Z");
  });

  it("validacao: campo desconhecido, sem lead, ambos, sem offset, passado, http, duracao, lead inexistente", async () => {
    const bad = async (b: unknown, status = 400) => expect((await call(b)).status).toBe(status);
    await bad({ leadId: fx.leadId, startsAt: startsIso(), extra: 1 });
    await bad({ startsAt: startsIso() });
    await bad({ leadId: fx.leadId, phone: "11955550001", startsAt: startsIso() });
    await bad({ leadId: fx.leadId, startsAt: "2099-05-01T14:00:00" });
    await bad({ leadId: fx.leadId, startsAt: "2020-01-01T10:00:00Z" });
    await bad({ leadId: fx.leadId, startsAt: startsIso(), link: "http://x.test" });
    await bad({ leadId: fx.leadId, startsAt: startsIso(), durationMin: 3 });
    await bad("{nao json");
    await bad({ leadId: crypto.randomUUID(), startsAt: startsIso() }, 404);
    await bad({ phone: "11900000000", startsAt: startsIso() }, 404);
  });

  it("telefone ambiguo = 409", async () => {
    const other = await prisma.campaign.create({ data: { name: "zz-test-mhook-2", icpId: (await prisma.campaign.findUniqueOrThrow({ where: { id: fx.campId } })).icpId, userId: fx.userId, orgId: fx.orgId } });
    const dup = await prisma.lead.create({ data: { campaignId: other.id, name: "Dup", phone: fx.phone, email: "dup@x.test" } });
    expect((await call({ phone: fx.phone, startsAt: startsIso() })).status).toBe(409);
    await prisma.lead.delete({ where: { id: dup.id } });
    await prisma.campaign.delete({ where: { id: other.id } });
  });

  it("nao ecoa corpo nem segredo em erro", async () => {
    const r = await call({ leadId: fx.leadId, startsAt: "nao-e-data", link: "https://segredo-zz.test" }, SECRET);
    const t = await r.text();
    expect(t).not.toContain("segredo-zz");
    expect(t).not.toContain(SECRET);
    const u = await (await call({}, "tentativa-zz-secreta")).text();
    expect(u).not.toContain("tentativa-zz-secreta");
  });

  it("429 + Retry-After apos excesso de tentativas invalidas; corpo grande = 413", async () => {
    for (let i = 0; i < 20; i++) expect((await call({}, "x")).status).toBe(401);
    const r = await call({}, "x");
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    _resetMeetingWebhookRateLimit();
    expect((await call("x".repeat(20_000))).status).toBe(413);
  });

  it("rota: 405 em GET; POST sem env configurado = 503 (desligado por padrao)", async () => {
    expect((await GET()).status).toBe(405);
    const prevE = process.env.INTEGRATION_LEADS_ENABLED;
    const prevS = process.env.INGEST_SECRET;
    delete process.env.INTEGRATION_LEADS_ENABLED;
    try {
      expect((await POST(new Request("http://x/api/integrations/meetings", { method: "POST", body: "{}" }))).status).toBe(503);
      process.env.INTEGRATION_LEADS_ENABLED = "true";
      process.env.INGEST_SECRET = SECRET;
      expect((await POST(new Request("http://x/api/integrations/meetings", { method: "POST", body: "{}" }))).status).toBe(401);
    } finally {
      if (prevE === undefined) delete process.env.INTEGRATION_LEADS_ENABLED; else process.env.INTEGRATION_LEADS_ENABLED = prevE;
      if (prevS === undefined) delete process.env.INGEST_SECRET; else process.env.INGEST_SECRET = prevS;
    }
  });
});
