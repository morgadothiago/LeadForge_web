import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { signAccessToken } from "./token";
import { getPeriodRanges } from "@/lib/queries/dashboard";
import { getMetrics } from "@/lib/dashboard/metrics";
import { budgetState } from "@/lib/agents/budget";
import { spec } from "@/lib/openapi";
import pg from "pg";
import Ajv from "ajv";
import { errorCategory, maskNumber, redactText, ERROR_CATEGORIES } from "./sanitize";
import { startOfDaySP } from "@/lib/channels/email";
import { getMobileScheduler, getMobileSummary, rate } from "./metrics";
import { GET as summary } from "@/app/api/mobile/v1/summary/route";
import { GET as pipeline } from "@/app/api/mobile/v1/pipeline/route";
import { GET as campaigns } from "@/app/api/mobile/v1/campaigns/route";
import { GET as campaign } from "@/app/api/mobile/v1/campaigns/[id]/route";
import { GET as instances } from "@/app/api/mobile/v1/whatsapp/instances/route";
import { GET as scheduler } from "@/app/api/mobile/v1/scheduler/route";
import { GET as agentsQueue } from "@/app/api/mobile/v1/agents/queue/route";
import { GET as searchRuns } from "@/app/api/mobile/v1/lead-search/runs/route";

const EMAIL = "zz-test-mobile-metrics@leadforge.local";
const FULL_NUMBER = "5511987654321";
const SECRET_KEY = "SECRET-API-KEY-ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const WEBHOOK = "webhook-token-super-secreto-1234567890";
let userId = "";
let deviceId = "";
let token = "";
let campId = "";
let icpId = "";
let instId = "";
let orgId = "";
const leadIds: string[] = [];
const req = (url = "http://x/api", t: string | null = token) => new Request(url, { headers: t ? { authorization: `Bearer ${t}` } : {} });

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  userId = (await prisma.user.create({ data: { name: "M", email: EMAIL, passwordHash: await hashPassword("Senha-Forte-Teste-123") } })).id;
  deviceId = (await prisma.mobileDevice.create({ data: { userId, name: "d", platform: "ios", refreshHash: `h-${crypto.randomUUID()}`, refreshExpiresAt: new Date(Date.now() + 1e9) } })).id;
  token = await signAccessToken(userId, deviceId);
  // SPEC-030: schema exige orgId; src/lib/mobile/metrics.ts ainda não é org-scoped em runtime (ver
  // Implementation Notes do spec.md) — só a fixture precisa de uma org válida.
  orgId = (await prisma.organization.create({ data: { name: "zz-metrics-org", slug: "zz-metrics-org", status: "active" } })).id;
  await prisma.membership.create({ data: { userId, orgId, orgRole: "owner" } });
  icpId = (await prisma.icpProfile.create({ data: { orgId, name: "zz-icp", niche: "n" } })).id;
  campId = (await prisma.campaign.create({ data: { name: "zz-metrics-camp", icpId, orgId, userId } })).id;
  instId = (await prisma.whatsAppInstance.create({ data: { orgId, instanceName: "zz-inst-metrics", number: FULL_NUMBER, webhookToken: WEBHOOK, apiKey: SECRET_KEY, warmupStartedAt: new Date() } })).id;
  await prisma.instanceAlert.create({ data: { instanceId: instId, kind: "possible_ban", message: "Possível banimento" } });
  // 3 leads: 2 contatados (1 respondeu), 1 ativo com nextTouchAt
  for (let i = 0; i < 3; i++) {
    const l = await prisma.lead.create({ data: { campaignId: campId, name: `Lead ${i} Silva`, email: `zz-m${i}@x.test`, phone: `55119000000${i}`, sequenceStatus: i === 0 ? "active" : "not_started", nextTouchAt: i === 0 ? new Date(Date.now() + 3600_000) : null } });
    leadIds.push(l.id);
  }
  const now = new Date();
  for (const id of leadIds.slice(0, 2)) await prisma.touch.create({ data: { leadId: id, channel: "whatsapp", direction: "outbound", status: "sent", sentAt: now, whatsappInstanceId: instId } });
  await prisma.touch.create({ data: { leadId: leadIds[0], channel: "whatsapp", direction: "inbound", status: "replied" } });
  await prisma.searchRun.create({ data: { campaignId: campId, source: "places", status: "error", error: "falhou https://api.x.com/v1?key=AIzaSECRET123 token abc123" } });
  await prisma.schedulerRun.create({ data: { orgId, startedAt: new Date(Date.now() - 1000), status: "error", error: "erro em https://h.io/?apikey=ZZZ" } });
});
afterAll(async () => {
  await prisma.schedulerRun.deleteMany({ where: { error: { contains: "h.io" } } });
  await prisma.searchRun.deleteMany({ where: { campaignId: campId } });
  await prisma.campaign.deleteMany({ where: { id: campId } }); // cascade leads/touches
  await prisma.whatsAppInstance.deleteMany({ where: { id: instId } });
  await prisma.icpProfile.deleteMany({ where: { id: icpId } });
  await prisma.mobileDevice.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.membership.deleteMany({ where: { orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
});

const routes: [string, (r: Request) => Promise<Response>][] = [
  ["/summary", summary], ["/pipeline", pipeline], ["/campaigns", campaigns], ["/whatsapp/instances", instances],
  ["/scheduler", scheduler], ["/agents/queue", agentsQueue], ["/lead-search/runs", searchRuns],
];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = async (r: Response) => (await r.json()) as { data: any; meta?: any };

describe("authz (todas as rotas)", () => {
  it("sem Bearer, Bearer web e dispositivo revogado = 401 com no-store", async () => {
    const { signSessionToken } = await import("@/lib/auth/session-token");
    const web = await signSessionToken(userId, orgId, "provider");
    const dev = await prisma.mobileDevice.create({ data: { userId, name: "rev", platform: "ios", refreshHash: `h-${crypto.randomUUID()}`, refreshExpiresAt: new Date(Date.now() + 1e9), revokedAt: new Date() } });
    const revoked = await signAccessToken(userId, dev.id);
    for (const [path, h] of routes) for (const t of [null, web, revoked]) {
      const r = await h(req("http://x/api", t));
      expect(r.status, `${path}`).toBe(401);
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
    expect((await campaign(req("http://x/api", null), { params: Promise.resolve({ id: campId }) })).status).toBe(401);
  });
});

describe("dados, paridade e no-store", () => {
  it("todas as rotas 200 com no-store", async () => {
    for (const [path, h] of routes) {
      const r = await h(req());
      expect(r.status, path).toBe(200);
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
  });
  it("AC1 paridade: /summary == queries da web; /pipeline == board", async () => {
    const now = new Date();
    const m = await getMetrics(orgId, getPeriodRanges(now, "7d"));
    const s = (await j(await summary(req()))).data;
    expect(s.newLeads.value).toBe(m.newLeads.value);
    expect(s.replied.value).toBe(m.replies.value);
    expect(s.meetings.value).toBe(m.meetings.value);
    expect(s.contacted.value).toBeGreaterThanOrEqual(2);
    expect(s.responseRate.contacted).toBe(s.contacted.value);
    expect(s.responseRate.rate).toBe(rate(s.responseRate.responded, s.responseRate.contacted));
    const p = (await j(await pipeline(req()))).data as { stage: string; count: number }[];
    expect(p).toHaveLength(7);
    const total = await prisma.opportunity.count({ where: { campaign: { orgId } } });
    expect(p.reduce((a, x) => a + x.count, 0)).toBe(total);
  });
  it("AC8: /summary < 5 KB; period invalido = 400", async () => {
    expect((await (await summary(req())).text()).length).toBeLessThan(5000);
    expect((await summary(req("http://x/api?period=1y"))).status).toBe(400);
  });
  it("AC5: taxa com denominador 0 = null", () => {
    expect(rate(0, 0)).toBeNull();
    expect(rate(1, 4)).toBe(0.25);
  });
  it("campanha: numeros e serie diaria 7d", async () => {
    const list = (await j(await campaigns(req("http://x/api?limit=50")))).data as { id: string; sent: number; replies: number; replyRate: number | null; activeLeads: number }[];
    const c = list.find((x) => x.id === campId)!;
    expect(c).toMatchObject({ sent: 2, replies: 1, replyRate: 0.5, activeLeads: 1 });
    const d = (await j(await campaign(req(), { params: Promise.resolve({ id: campId }) }))).data;
    expect(d.daily).toHaveLength(7);
    expect(d.daily.reduce((a: number, x: { sent: number }) => a + x.sent, 0)).toBe(2);
    expect((await campaign(req(), { params: Promise.resolve({ id: crypto.randomUUID() }) })).status).toBe(404);
    expect((await campaigns(req("http://x/api?status=xx"))).status).toBe(400);
  });
  it("AC7: 50 campanhas -> poucas queries (sem N+1) e paginacao por cursor", async () => {
    await prisma.campaign.createMany({ data: Array.from({ length: 50 }, (_, i) => ({ name: `zz-bulk-${i}`, icpId, orgId, userId })) });
    try {
      const spies = [vi.spyOn(prisma.campaign, "findMany"), vi.spyOn(prisma.lead, "groupBy"), vi.spyOn(prisma, "$queryRaw")];
      const one = await j(await campaigns(req("http://x/api?limit=50")));
      expect(one.data.length).toBeGreaterThanOrEqual(50);
      // 1 findMany + 1 raw + 1 groupBy para 50 campanhas (total <= 8, sem N+1)
      expect(spies.map((x) => x.mock.calls.length)).toEqual([1, 1, 1]);
      spies.forEach((x) => x.mockRestore());
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const r: { data: { id: string }[]; meta: { nextCursor: string | null } } = await j(await campaigns(req(`http://x/api?limit=20${cursor ? `&cursor=${cursor}` : ""}`))) as never;
        seen.push(...r.data.map((x) => x.id));
        cursor = r.meta.nextCursor;
      } while (cursor);
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen.length).toBeGreaterThanOrEqual(51);
    } finally {
      await prisma.campaign.deleteMany({ where: { name: { startsWith: "zz-bulk-" } } });
    }
  });
  it("AC2: instancias nunca expoem numero completo, apiKey ou webhookToken", async () => {
    const txt = await (await instances(req())).text();
    for (const bad of [FULL_NUMBER, SECRET_KEY, WEBHOOK, "apiKey", "webhookToken"]) expect(txt).not.toContain(bad);
    const item = (JSON.parse(txt).data as { id: string; numberMasked: string; alerts: { kind: string }[] }[]).find((x) => x.id === instId)!;
    expect(item.numberMasked).toBe("••••4321");
    expect(item.alerts[0].kind).toBe("possible_ban");
  });
  it("nao-vazamento: nenhuma rota contem PII/segredos/erros com URL", async () => {
    const forbidden = ["passwordHash", "refreshHash", "apiKey", "webhookToken", "zz-m0@x.test", "5511900000", "Lead 0", "AIzaSECRET123", "apikey=ZZZ", "https://"];
    for (const [path, h] of routes) {
      const txt = await (await h(req())).text();
      for (const f of forbidden) expect(txt, `${path} contem ${f}`).not.toContain(f);
    }
  });
  it("erros sanitizados e mascaramento (funcoes puras)", () => {
    expect(redactText("x https://a.b/c?key=1 e a@b.com")).toBe("x [url] e [email]");
    expect(maskNumber("+55 (11) 98765-4321")).toBe("••••4321");
    expect(maskNumber(null)).toBeNull();
  });
});

describe("scheduler stale, orcamento e fuso", () => {
  it("AC3: stale conforme relogio injetado (limiar 2x intervalo)", async () => {
    const t0 = new Date("2030-01-01T12:00:00Z");
    await prisma.schedulerRun.deleteMany({ where: { startedAt: { gte: new Date("2029-12-31"), lte: new Date("2030-01-02") } } });
    const run = await prisma.schedulerRun.create({ data: { orgId, startedAt: t0, finishedAt: new Date(t0.getTime() + 1000), status: "ok" } });
    try {
      // Runs 'ok' mais recentes de outros testes/dados reais nao existem no futuro (2030): o mais recente e o nosso.
      expect((await getMobileScheduler(orgId, new Date(t0.getTime() + 3 * 60_000))).stale).toBe(false);
      expect((await getMobileScheduler(orgId, new Date(t0.getTime() + 5 * 60_000))).stale).toBe(true);
    } finally {
      await prisma.schedulerRun.delete({ where: { id: run.id } });
    }
  });
  it("AC4: orcamento 79% ok, 80% alert, 100% exhausted, sem teto no_budget", () => {
    expect(budgetState(79 * 10_000, 100)).toBe("ok");
    expect(budgetState(80 * 10_000, 100)).toBe("alert");
    expect(budgetState(100 * 10_000, 100)).toBe("exhausted");
    expect(budgetState(5, null)).toBe("no_budget");
  });
  it("AC6: 'enviadas hoje' usa o dia de Sao Paulo (startOfDaySP)", async () => {
    const now = new Date();
    const before = (await getMobileSummary(orgId, "7d", now)).sentToday.whatsapp.sent;
    const start = startOfDaySP(now);
    const mk = (sentAt: Date) => prisma.touch.create({ data: { leadId: leadIds[2], channel: "whatsapp", direction: "outbound", status: "sent", sentAt, whatsappInstanceId: instId } });
    await mk(new Date(start.getTime() - 60_000)); // 23:59 SP de ontem: nao conta
    expect((await getMobileSummary(orgId, "7d", now)).sentToday.whatsapp.sent).toBe(before);
    await mk(new Date(start.getTime() + 60_000)); // 00:01 SP de hoje: conta (se ainda for hoje)
    if (new Date(start.getTime() + 60_000) <= now) expect((await getMobileSummary(orgId, "7d", now)).sentToday.whatsapp.sent).toBe(before + 1);
  });
  it("/agents/queue e /scheduler: formato", async () => {
    const q = (await j(await agentsQueue(req()))).data;
    expect(["ok", "alert", "exhausted", "no_budget"]).toContain(q.budget.budgetState);
    expect(typeof q.killSwitch).toBe("boolean");
    const sc = (await j(await scheduler(req()))).data;
    expect(typeof sc.stale).toBe("boolean");
    expect(sc.recentErrors.length).toBeGreaterThan(0);
    expect(JSON.stringify(sc.recentErrors)).not.toContain("h.io");
    for (const e of sc.recentErrors as { error: string | null }[]) expect(e.error === null || (ERROR_CATEGORIES as readonly string[]).includes(e.error)).toBe(true);
  });
  it("AC8 contrato: rotas de dados nao estao mais 'planned'", () => {
    for (const p of ["/summary", "/pipeline", "/campaigns", "/campaigns/{id}", "/whatsapp/instances", "/scheduler", "/agents/queue", "/lead-search/runs"]) {
      expect(JSON.stringify((spec.paths as Record<string, unknown>)[p])).not.toContain("planned");
    }
  });
});

describe("sanitize adversarial (QA)", () => {
  const leaks = ["10.0.0.5", "8080", "evolution.internal", "evolution:8080", "u:p@db", "5432", "/app/src", "eyJhbGciOi", "abc.def", "AIza123", "SEGREDO", "a@b.com", "5511987654321", "987654321", "12345678"];
  const inputs = [
    "ECONNREFUSED 10.0.0.5:8080", "getaddrinfo ENOTFOUND evolution.internal", "fetch failed at evolution:8080/instance/x",
    "postgres://u:p@db:5432/x", "Error at /app/src/lib/x.ts:12:5", "Authorization: Bearer eyJhbGciOi.abc.def", "authorization=Basic dXNlcjpwYXNz",
    "url ?key=AIza123 falhou", '{"apikey":"SEGREDO","x":1}', "contato a@b.com +5511987654321", "tel 987654321 e 12345678", "redis://cache:6379 amqp://u:p@mq:5672",
  ];
  it("errorCategory: so devolve categorias da allowlist, nunca texto original", () => {
    for (const i of inputs) {
      const c = errorCategory(i)!;
      expect((ERROR_CATEGORIES as readonly string[]).includes(c), i).toBe(true);
      for (const l of leaks) expect(c).not.toContain(l);
    }
    expect(errorCategory("ECONNREFUSED 10.0.0.5:8080")).toBe("falha de conexao com o provedor");
    expect(errorCategory("getaddrinfo ENOTFOUND evolution.internal")).toBe("falha de conexao com o provedor");
    expect(errorCategory("HTTP 429 Too Many Requests")).toBe("limite de requisicoes");
    expect(errorCategory("request timed out")).toBe("tempo esgotado");
    expect(errorCategory("401 Unauthorized")).toBe("nao autorizado pelo provedor");
    expect(errorCategory("algo estranho")).toBe("erro");
    expect(errorCategory("")).toBeNull();
    expect(errorCategory(null)).toBeNull();
  });
  it("redactText L2: cookie, set-cookie e 'secret is X' / 'senha e X'", () => {
    for (const [i, leak] of [["cookie: a=b; c=d", /a=b|c=d/], ["Set-Cookie: sid=abc123; Path=/", /sid=abc123/], ["the secret is hunter2hunter2", /hunter2/], ["senha e Abc12345xyz", /Abc12345/], ["password is: hunter2", /hunter2/], ["token = zzz999", /zzz999/]] as [string, RegExp][]) {
      expect(redactText(i)).not.toMatch(leak);
    }
  });

  it("redactText: defesa em profundidade remove segredos, hosts, esquemas, caminhos, e-mail e numeros", () => {
    for (const i of inputs) {
      const r = redactText(i)!;
      for (const l of leaks) expect(r, `${i} -> ${r}`).not.toContain(l);
    }
    expect(redactText("Authorization: Bearer eyJhbGciOi.abc.def")).not.toMatch(/eyJ|abc\.def/);
    const json = redactText('{"apikey":"SEGREDO","msg":"ok"}')!;
    expect(json).toContain('"apikey":"[redacted]"');
    expect(json).toContain('"msg"');
  });
});

describe("AC7 contagem real de queries e conformidade de schema", () => {
  const countQueries = async (fn: () => Promise<unknown>) => {
    const orig = pg.Client.prototype.query;
    let n = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pg.Client.prototype as any).query = function (this: unknown, ...a: any[]) {
      const t = typeof a[0] === "string" ? a[0] : a[0]?.text;
      if (typeof t === "string" && /^\s*(select|with|insert|update|delete)/i.test(t)) n++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (orig as any).apply(this, a);
    };
    try { await fn(); } finally { pg.Client.prototype.query = orig; }
    return n;
  };
  it("/whatsapp/instances: numero de queries constante (50 instancias) e /summary <= 8", async () => {
    const one = await countQueries(async () => { await instances(req()); });
    const ids = (await prisma.whatsAppInstance.createManyAndReturn({ data: Array.from({ length: 50 }, (_, i) => ({ orgId, instanceName: `zz-bulk-inst-${i}`, number: `5511900${String(i).padStart(6, "0")}`, webhookToken: `zz-wh-${crypto.randomUUID()}`, warmupStartedAt: new Date() })), select: { id: true } })).map((x) => x.id);
    try {
      await prisma.instanceAlert.createMany({ data: ids.map((instanceId) => ({ instanceId, kind: "warning", message: "x" })) });
      const fifty = await countQueries(async () => { expect((await instances(req())).status).toBe(200); });
      process.stderr.write(`AC7-INST=${one} vs ${fifty}\n`);
      expect(fifty).toBe(one);
      expect(fifty).toBeLessThanOrEqual(8);
    } finally {
      await prisma.whatsAppInstance.deleteMany({ where: { id: { in: ids } } });
    }
    const sum = await countQueries(async () => { expect((await summary(req())).status).toBe(200); });
    process.stderr.write(`AC7-SUMMARY=${sum}\n`);
    expect(sum).toBeLessThanOrEqual(8);
  });
  it("respostas REAIS das 8 rotas validam contra o schema do OpenAPI (additionalProperties:false)", async () => {
    // Ajv v8 removeu a option `unknownFormats` (era do v6); `strict: false` tem o mesmo efeito aqui:
    // formatos desconhecidos (date-time etc., sem ajv-formats) são ignorados em vez de derrubar o compile.
    const ajv = new Ajv({ allErrors: true, strict: false });
    const resolve = (path: string) => {
      const item = (spec.paths as unknown as Record<string, { get: { responses: { "200": { content: { "application/json": { schema: object } } } } } }>)[path];
      return item.get.responses["200"].content["application/json"].schema;
    };
    const check = async (path: string, res: Response) => {
      expect(res.status, path).toBe(200);
      const body = await res.json();
      const validate = ajv.compile({ components: spec.components, ...resolve(path) });
      expect(validate(body), `${path}: ${JSON.stringify(validate.errors)}`).toBe(true);
    };
    await check("/summary", await summary(req()));
    await check("/pipeline", await pipeline(req()));
    await check("/campaigns", await campaigns(req("http://x/api?limit=50")));
    await check("/campaigns/{id}", await campaign(req(), { params: Promise.resolve({ id: campId }) }));
    await check("/whatsapp/instances", await instances(req()));
    await check("/scheduler", await scheduler(req()));
    await check("/agents/queue", await agentsQueue(req()));
    await check("/lead-search/runs", await searchRuns(req()));
  });
});
