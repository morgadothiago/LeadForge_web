import "dotenv/config";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Ajv from "ajv";
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { signSessionToken } from "@/lib/auth/session-token";
import { createHttpClient } from "@/lib/http/client";
import { spec } from "@/lib/openapi";
import { signAccessToken } from "./token";
import { ALERT_RETENTION_MS, BASELINE_KEY, PUSH_WAIT_CAP_MS, cleanupMobile, raiseAlert, sweepAlerts, sweepThrottled, _resetSweepThrottle, type Candidate } from "./alerts";
import { _setExpoClient, prefAllows } from "./expo-push";
import { runTick } from "@/lib/scheduler/run-tick";
import { GET as listAlerts } from "@/app/api/mobile/v1/alerts/route";
import { GET as unreadCount } from "@/app/api/mobile/v1/alerts/unread-count/route";
import { POST as readAll } from "@/app/api/mobile/v1/alerts/read-all/route";
import { POST as readOne } from "@/app/api/mobile/v1/alerts/[id]/read/route";
import { PUT as putToken, DELETE as delToken } from "@/app/api/mobile/v1/devices/push-token/route";
import { POST as logout } from "@/app/api/mobile/v1/auth/logout/route";
import { DELETE as delDevice } from "@/app/api/mobile/v1/devices/[id]/route";

const EMAIL = "zz-test-mobile-alerts@leadforge.local";
const LEAD_NAME = "Maria Zzalerta Silva";
const LEAD_EMAIL = "zz-alerta-maria@x.test";
const LEAD_PHONE = "5511977776666";
const MSG = "mensagem-secreta-do-lead-xyz";
const TOKEN_A = "ExponentPushToken[zzAAAA]";
const TOKEN_B = "ExponentPushToken[zzBBBB]";
const TOKEN_C = "ExponentPushToken[zzCCCC]";
let userId = "";
let devA = "", devB = "";
let tokA = "", tokB = "";
let icpId = "", campId = "", instId = "", leadId = "", orgId = "";

const hdr = (t: string | null): RequestInit => ({ headers: t ? { authorization: `Bearer ${t}` } : {} });
const get = (t: string | null, url = "http://x/api") => new Request(url, hdr(t));
const send = (method: string, t: string | null, body?: unknown, url = "http://x/api") =>
  new Request(url, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) } as Record<string, string> } : hdr(t)) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const cleanAlerts = () => prisma.mobileAlert.deleteMany({});
const seedBaseline = () => prisma.mobileAlert.create({ data: { kind: "baseline", severity: "baixa", dedupeKey: BASELINE_KEY, title: "baseline", body: "baseline", refType: "scheduler", readAt: new Date(), resolvedAt: new Date() } });

async function mkDevice(name: string, extra: object = {}) {
  return (await prisma.mobileDevice.create({ data: { userId, name, platform: "android", refreshHash: `h-${crypto.randomUUID()}`, refreshExpiresAt: new Date(Date.now() + 1e9), ...extra } })).id;
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  userId = (await prisma.user.create({ data: { name: "A", email: EMAIL, role: "provider", passwordHash: await hashPassword("Senha-Forte-Teste-123") } })).id;
  // SPEC-030: schema exige orgId (Campaign/IcpProfile/WhatsAppInstance); runTick() também exige Organization ativa.
  orgId = (await prisma.organization.create({ data: { name: "zz-alerts-org", slug: "zz-alerts-org", status: "active" } })).id;
  await prisma.membership.create({ data: { userId, orgId, orgRole: "owner" } });
  devA = await mkDevice("A", { pushToken: TOKEN_A });
  devB = await mkDevice("B", { pushToken: TOKEN_B });
  tokA = await signAccessToken(userId, devA);
  tokB = await signAccessToken(userId, devB);
  icpId = (await prisma.icpProfile.create({ data: { orgId, name: "zz-icp-alerts", niche: "n" } })).id;
  campId = (await prisma.campaign.create({ data: { name: "zz-alerts-camp", icpId, orgId, userId } })).id;
  leadId = (await prisma.lead.create({ data: { campaignId: campId, name: LEAD_NAME, email: LEAD_EMAIL, phone: LEAD_PHONE } })).id;
  instId = (await prisma.whatsAppInstance.create({ data: { orgId, instanceName: "zz-inst-alerts", number: LEAD_PHONE, webhookToken: `wt-${crypto.randomUUID()}`, status: "connected" } })).id;
});
beforeEach(async () => {
  await cleanAlerts();
  await seedBaseline();
  _resetSweepThrottle();
  delete process.env.MOBILE_PUSH_ENABLED;
  _setExpoClient(undefined);
});
afterEach(() => {
  delete process.env.MOBILE_PUSH_ENABLED;
  _setExpoClient(undefined);
  vi.restoreAllMocks();
});
afterAll(async () => {
  await cleanAlerts();
  await prisma.lead.deleteMany({ where: { campaignId: campId } });
  await prisma.campaign.deleteMany({ where: { id: campId } });
  await prisma.whatsAppInstance.deleteMany({ where: { id: instId } });
  await prisma.icpProfile.deleteMany({ where: { id: icpId } });
  await prisma.mobileDevice.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.membership.deleteMany({ where: { orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
});

const mine = (kind: string, ref: string) => prisma.mobileAlert.findMany({ where: { kind, refId: ref } });

describe("gatilhos, severidade, dedupe e resolucao (AC1-3)", () => {
  it("WhatsApp desconectou: alta; mesmo episodio nao duplica; novo episodio gera; resolve ao reconectar", async () => {
    const t0 = new Date(Date.now() - 3600_000);
    await prisma.whatsAppInstance.update({ where: { id: instId }, data: { status: "disconnected", disconnectedAt: t0 } });
    await sweepAlerts();
    await sweepAlerts();
    let rows = await mine("wa_disconnected", instId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ severity: "alta", title: "WhatsApp desconectou", refType: "instance", resolvedAt: null });
    await prisma.whatsAppInstance.update({ where: { id: instId }, data: { status: "connected", disconnectedAt: null } });
    await sweepAlerts();
    rows = await mine("wa_disconnected", instId);
    expect(rows[0].resolvedAt).not.toBeNull();
    await prisma.whatsAppInstance.update({ where: { id: instId }, data: { status: "disconnected", disconnectedAt: new Date() } });
    await sweepAlerts();
    expect(await mine("wa_disconnected", instId)).toHaveLength(2);
    await prisma.whatsAppInstance.update({ where: { id: instId }, data: { status: "connected", disconnectedAt: null } });
  });

  it("instancia pausada (possivel banimento): critica, resolve ao retomar", async () => {
    await prisma.whatsAppInstance.update({ where: { id: instId }, data: { health: "paused", pausedUntil: new Date(Date.now() + 3600_000), pausedReason: `falha em https://x.io/?key=SEGREDO ${LEAD_PHONE}` } });
    await sweepAlerts();
    const rows = await mine("wa_paused", instId);
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe("critica");
    expect(JSON.stringify(rows)).not.toContain("SEGREDO");
    await prisma.whatsAppInstance.update({ where: { id: instId }, data: { health: "good", pausedUntil: null, pausedReason: null } });
    await sweepAlerts();
    expect((await mine("wa_paused", instId))[0].resolvedAt).not.toBeNull();
  });

  it("opt-out em massa: alta quando supressoes por opt-out >= limite; resolve quando cai", async () => {
    const vals = Array.from({ length: 5 }, (_, i) => `zz-optout-${i}-${crypto.randomUUID()}@x.test`);
    await prisma.suppression.createMany({ data: vals.map((value) => ({ orgId, kind: "email", value, reason: "opt_out_reply" })) });
    try {
      await sweepAlerts();
      const rows = await prisma.mobileAlert.findMany({ where: { kind: "mass_opt_out" } });
      expect(rows).toHaveLength(1);
      expect(rows[0].severity).toBe("alta");
      await prisma.suppression.deleteMany({ where: { value: { in: vals } } });
      await sweepAlerts();
      expect((await prisma.mobileAlert.findMany({ where: { kind: "mass_opt_out" } })).every((r) => r.resolvedAt)).toBe(true);
    } finally {
      await prisma.suppression.deleteMany({ where: { value: { in: vals } } });
    }
  });

  it("handoff do Closer: alta, com link https da call (so na API), sem PII; resolve quando o lead sai de needsHuman", async () => {
    const agent = await prisma.agent.create({ data: { orgId, role: "closer", name: "zz-closer-alerts", callLink: "https://cal.example.com/call-zz", monthlyBudgetCents: null } });
    try {
      await prisma.lead.update({ where: { id: leadId }, data: { needsHuman: true, handoffAt: new Date(), handoffReason: `${LEAD_NAME} pediu ligação` } });
      await sweepAlerts();
      const [a] = await mine("handoff", leadId);
      expect(a).toMatchObject({ severity: "alta", title: "Precisa de você", refType: "lead", link: "https://cal.example.com/call-zz" });
      expect(JSON.stringify(a)).not.toContain(LEAD_NAME);
      await prisma.lead.update({ where: { id: leadId }, data: { needsHuman: false } });
      await sweepAlerts();
      expect((await mine("handoff", leadId))[0].resolvedAt).not.toBeNull();
    } finally {
      await prisma.agent.delete({ where: { id: agent.id } });
      await prisma.lead.update({ where: { id: leadId }, data: { needsHuman: false, handoffAt: null, handoffReason: null } });
    }
  });

  it("link nao-https nunca e gravado", async () => {
    await raiseAlert({ kind: "handoff", severity: "alta", dedupeKey: "handoff:zz-js", title: "t", body: "b", refType: "lead", refId: null, link: "javascript:alert(1)" });
    expect((await prisma.mobileAlert.findUniqueOrThrow({ where: { dedupeKey: "handoff:zz-js" } })).link).toBeNull();
  });

  it("orcamento 80% = media, 100% = alta (por agente); resolve quando volta ao normal", async () => {
    const agent = await prisma.agent.create({ data: { orgId, role: "sdr", name: "zz-sdr-budget", monthlyBudgetCents: 100 } });
    try {
      const run = await prisma.agentRun.create({ data: { agentId: agent.id, leadId, trigger: "zz", costMicros: 85 * 10_000 } });
      await sweepAlerts();
      expect((await mine("budget_alert", agent.id))[0]).toMatchObject({ severity: "media", title: "Orçamento em 80%", refType: "budget" });
      await prisma.agentRun.update({ where: { id: run.id }, data: { costMicros: 100 * 10_000 } });
      await sweepAlerts();
      expect((await mine("budget_exhausted", agent.id))[0]).toMatchObject({ severity: "alta" });
      expect((await mine("budget_alert", agent.id))[0].resolvedAt).not.toBeNull();
      await prisma.agentRun.update({ where: { id: run.id }, data: { costMicros: 0 } });
      await sweepAlerts();
      expect((await mine("budget_exhausted", agent.id))[0].resolvedAt).not.toBeNull();
    } finally {
      await prisma.agent.delete({ where: { id: agent.id } });
    }
  });

  it("scheduler parado: alta com relogio injetado; resolve quando volta a rodar", async () => {
    const run = await prisma.schedulerRun.create({ data: { startedAt: new Date(), finishedAt: new Date(), status: "ok" } });
    try {
      await sweepAlerts(new Date(Date.now() + 3600_000));
      const st = await prisma.mobileAlert.findMany({ where: { kind: "scheduler_stale", resolvedAt: null } });
      expect(st).toHaveLength(1);
      expect(st[0].severity).toBe("alta");
      await sweepAlerts();
      expect(await prisma.mobileAlert.count({ where: { kind: "scheduler_stale", resolvedAt: null } })).toBe(0);
    } finally {
      await prisma.schedulerRun.delete({ where: { id: run.id } });
    }
  });

  it("lead respondeu: baixa, agrupado por janela de 5 min (nao duplica), sem texto da mensagem", async () => {
    await prisma.touch.create({ data: { leadId, channel: "whatsapp", direction: "inbound", status: "replied", content: MSG } });
    await sweepAlerts(new Date(Date.now() + 1000));
    await sweepAlerts(new Date(Date.now() + 2000));
    const rows = await prisma.mobileAlert.findMany({ where: { kind: "lead_replied" } });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.length).toBeLessThanOrEqual(2); // limite de bucket no cruzamento de janela
    expect(rows[0].severity).toBe("baixa");
    expect(JSON.stringify(rows)).not.toContain(MSG);
    await prisma.touch.deleteMany({ where: { leadId, content: MSG } });
  });

  it("falha do emissor nunca derruba o tick: sweep com banco falhando so loga", async () => {
    vi.spyOn(prisma.whatsAppInstance, "findMany").mockRejectedValue(new Error("db down https://x.io/?key=SEGREDO"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(sweepAlerts()).resolves.toEqual({ raised: 0 });
    await expect(sweepThrottled()).resolves.toBeUndefined();
    expect(warn.mock.calls.flat().join(" ")).not.toContain("SEGREDO");
  });

  it("runTick chama o emissor e continua ok mesmo se ele falhar", async () => {
    vi.spyOn(prisma.whatsAppInstance, "findMany").mockRejectedValueOnce(new Error("boom")).mockResolvedValue([]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await runTick(new Date(), { acquireLock: async () => ({ release: async () => {} }) });
    expect(["ok", "error"]).toContain(r.status);
    expect(r.status).not.toBe("locked");
  });
});

describe("push Expo (AC4-6, 8)", () => {
  type Sent = { url?: string; body: { to: string; title: string; body: string; data: Record<string, unknown> }[] };
  function fakeExpo(responder: (n: number, cfg: InternalAxiosRequestConfig) => { status: number; data?: unknown; headers?: Record<string, string> }) {
    const sent: Sent[] = [];
    const sleeps: number[] = [];
    let n = 0;
    const adapter: AxiosAdapter = async (cfg) => {
      sent.push({ url: cfg.url, body: JSON.parse(cfg.data as string) });
      const r = responder(n++, cfg);
      const response = { status: r.status, statusText: "", data: r.data ?? {}, headers: r.headers ?? {}, config: cfg, request: {} };
      if (r.status >= 400) throw new AxiosError("fail", "ERR_BAD_RESPONSE", cfg, {}, response as never);
      return response as never;
    };
    _setExpoClient(createHttpClient({ name: "Expo Push", baseURL: "https://exp.host/--/api/v2", adapter, retry: { maxAttempts: 3, sleep: async (ms) => void sleeps.push(ms), random: () => 1 }, logger: () => {} }));
    return { sent, sleeps };
  }
  const candidate = (k: string): Candidate => ({ kind: "wa_disconnected", severity: "alta", dedupeKey: `wa_disconnected:zz-${k}`, title: "WhatsApp desconectou", body: "Uma instância de WhatsApp está desconectada. Abra o app para ver os detalhes.", refType: "instance", refId: null });

  it("AC6: flag desligada = nenhuma chamada externa; polling continua", async () => {
    const f = fakeExpo(() => ({ status: 200, data: { data: [] } }));
    await raiseAlert(candidate("off"));
    expect(f.sent).toHaveLength(0);
    const r = await listAlerts(get(tokA));
    expect((await r.json()).data.some((a: { dedupeKey?: string; kind: string }) => a.kind === "wa_disconnected")).toBe(true);
  });

  it("AC4: push generico (titulo do tipo, corpo fixo, data so alertId) sem PII; 1 push por dedupeKey; revogado nao recebe; lead_replied opt-in", async () => {
    process.env.MOBILE_PUSH_ENABLED = "true";
    await mkDevice("C", { pushToken: TOKEN_C, revokedAt: new Date() });
    await prisma.lead.update({ where: { id: leadId }, data: { needsHuman: true, handoffAt: new Date(), handoffReason: `${LEAD_NAME} ${LEAD_EMAIL}` } });
    await prisma.touch.create({ data: { leadId, channel: "whatsapp", direction: "inbound", status: "replied", content: MSG } });
    const f = fakeExpo((_n, cfg) => ({ status: 200, data: { data: JSON.parse(cfg.data as string).map(() => ({ status: "ok", id: "t" })) } }));
    try {
      await raiseAlert(candidate("push"));
      await raiseAlert(candidate("push")); // mesmo episodio: sem novo push
      expect(f.sent).toHaveLength(1);
      const tos = f.sent[0].body.map((m) => m.to).sort();
      expect(tos).toContain(TOKEN_A);
      expect(tos).toContain(TOKEN_B);
      expect(tos).not.toContain(TOKEN_C);
      const [msg] = f.sent[0].body;
      const alert = await prisma.mobileAlert.findUniqueOrThrow({ where: { dedupeKey: "wa_disconnected:zz-push" } });
      expect(Object.keys(msg.data)).toEqual(["alertId"]);
      expect(msg.data.alertId).toBe(alert.id);
      await sweepAlerts(new Date(Date.now() + 1000)); // gera handoff + lead_replied
      const payload = JSON.stringify(f.sent);
      for (const bad of [LEAD_NAME, "Maria", LEAD_EMAIL, LEAD_PHONE, MSG, "https://cal", TOKEN_A.slice(0, 5) + "x"]) expect(payload, bad).not.toContain(bad);
      // lead_replied nao e enviado por padrao (opt-in); handoff sim
      expect(payload).toContain("Precisa de você");
      expect(payload).not.toContain("Lead respondeu");
      // opt-in ligado no dispositivo A
      expect(prefAllows({ lead_replied: true }, "lead_replied")).toBe(true);
      expect(prefAllows({ handoff: false }, "handoff")).toBe(false);
      expect(prefAllows(null, "handoff")).toBe(true);
    } finally {
      await prisma.touch.deleteMany({ where: { leadId, content: MSG } });
      await prisma.lead.update({ where: { id: leadId }, data: { needsHuman: false, handoffAt: null, handoffReason: null } });
    }
  });

  it("AC5: DeviceNotRegistered limpa pushToken (so do dispositivo afetado)", async () => {
    process.env.MOBILE_PUSH_ENABLED = "true";
    fakeExpo((_n, cfg) => ({ status: 200, data: { data: JSON.parse(cfg.data as string).map((m: { to: string }) => (m.to === TOKEN_B ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok" })) } }));
    await raiseAlert(candidate("dnr"));
    expect((await prisma.mobileDevice.findUniqueOrThrow({ where: { id: devB } })).pushToken).toBeNull();
    expect((await prisma.mobileDevice.findUniqueOrThrow({ where: { id: devA } })).pushToken).toBe(TOKEN_A);
    await prisma.mobileDevice.update({ where: { id: devB }, data: { pushToken: TOKEN_B } });
  });

  it("429 com Retry-After: espera o indicado e faz retry; sem Retry-After: backoff; esgota sem lancar e sem vazar token", async () => {
    process.env.MOBILE_PUSH_ENABLED = "true";
    const f1 = fakeExpo((n) => (n === 0 ? { status: 429, headers: { "retry-after": "2" } } : { status: 200, data: { data: [{ status: "ok" }, { status: "ok" }] } }));
    await raiseAlert(candidate("r1"));
    expect(f1.sent).toHaveLength(2);
    expect(f1.sleeps).toEqual([2000]);
    const f2 = fakeExpo((n) => (n === 0 ? { status: 429 } : { status: 200, data: { data: [] } }));
    await raiseAlert(candidate("r2"));
    expect(f2.sent).toHaveLength(2);
    expect(f2.sleeps).toHaveLength(1);
    expect(f2.sleeps[0]).toBeGreaterThan(0);
    const f3 = fakeExpo(() => ({ status: 503 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(raiseAlert(candidate("r3"))).resolves.toBe(true); // alerta criado; falha do Expo nao derruba
    expect(f3.sent).toHaveLength(3); // retry limitado
    expect(warn.mock.calls.flat().join(" ")).not.toContain("ExponentPushToken");
  });
});

describe("API (AC7, authz, IDOR)", () => {
  it("sem Bearer / Bearer web / dispositivo revogado = 401 em todas as rotas", async () => {
    const web = await signSessionToken(userId, orgId, "provider");
    const revokedDev = await mkDevice("R", { revokedAt: new Date() });
    const revoked = await signAccessToken(userId, revokedDev);
    const calls: [string, (t: string | null) => Promise<Response>][] = [
      ["GET /alerts", (t) => listAlerts(get(t))],
      ["GET /unread-count", (t) => unreadCount(get(t))],
      ["POST /read-all", (t) => readAll(send("POST", t))],
      ["POST /{id}/read", (t) => readOne(send("POST", t), ctx(crypto.randomUUID()))],
      ["PUT /push-token", (t) => putToken(send("PUT", t, { token: TOKEN_A }))],
      ["DELETE /push-token", (t) => delToken(send("DELETE", t))],
    ];
    for (const [name, call] of calls) for (const t of [null, web, revoked]) {
      const r = await call(t);
      expect(r.status, name).toBe(401);
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
    // token de dispositivo revogado nao ganha alertas: e o guard que barra; e push nao vai para revogado (ver teste de push)
    expect((await prisma.mobileDevice.findUniqueOrThrow({ where: { id: devA } })).pushToken).toBe(TOKEN_A);
  });

  it("AC7: paginacao por cursor sem duplicar, unread, read/read-all idempotentes, contagem correta, no-store", async () => {
    for (let i = 0; i < 7; i++) await raiseAlert({ kind: "scheduler_stale", severity: "alta", dedupeKey: `scheduler_stale:zz-${i}`, title: "Scheduler parado", body: "b", refType: "scheduler", refId: null });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `http://x/api?limit=3${cursor ? `&cursor=${cursor}` : ""}`;
      const r = await listAlerts(get(tokA, url));
      expect(r.headers.get("cache-control")).toBe("no-store");
      const j = await r.json();
      seen.push(...j.data.map((a: { id: string }) => a.id));
      cursor = j.meta.nextCursor;
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThanOrEqual(7);
    expect((await listAlerts(get(tokA, "http://x/api?cursor=@@@"))).status).toBe(400);
    expect((await listAlerts(get(tokA, "http://x/api?unread=talvez"))).status).toBe(400);
    const cnt = async () => (await (await unreadCount(get(tokA))).json()).data.count as number;
    const total = await cnt();
    expect(total).toBe(await prisma.mobileAlert.count({ where: { readAt: null } }));
    const id = (await prisma.mobileAlert.findFirstOrThrow({ where: { readAt: null, kind: "scheduler_stale" } })).id; // nao-lido garantido (SPEC-028: lembretes de reuniao do seed podem nascer lidos)
    const r1 = await (await readOne(send("POST", tokA), ctx(id))).json();
    const r2 = await (await readOne(send("POST", tokA), ctx(id))).json();
    expect(r2.data.readAt).toBe(r1.data.readAt); // idempotente: nao reescreve readAt
    expect(await cnt()).toBe(total - 1);
    expect((await readOne(send("POST", tokA), ctx(crypto.randomUUID()))).status).toBe(404);
    expect((await readOne(send("POST", tokA), ctx("nao-e-uuid"))).status).toBe(404);
    const unread = await (await listAlerts(get(tokA, "http://x/api?unread=true&limit=50"))).json();
    expect(unread.data.every((a: { readAt: unknown }) => a.readAt === null)).toBe(true);
    await readAll(send("POST", tokA));
    const again = await (await readAll(send("POST", tokA))).json();
    expect(again.data.updated).toBe(0);
    expect(await cnt()).toBe(0);
  });

  it("IDOR: dispositivo A so altera o PROPRIO token; token de B intocado; mesmo token migra sem duplicar; validacao", async () => {
    const before = (await prisma.mobileDevice.findUniqueOrThrow({ where: { id: devB } })).pushToken;
    const r = await putToken(send("PUT", tokA, { token: "ExponentPushToken[zzNOVO]", prefs: { lead_replied: true } }));
    expect(r.status).toBe(200);
    expect(await r.text()).not.toContain("zzNOVO"); // nunca ecoa
    expect((await prisma.mobileDevice.findUniqueOrThrow({ where: { id: devB } })).pushToken).toBe(before);
    const a = await prisma.mobileDevice.findUniqueOrThrow({ where: { id: devA } });
    expect(a.pushToken).toBe("ExponentPushToken[zzNOVO]");
    expect(a.pushPrefs).toEqual({ lead_replied: true });
    // B registra o token de A: sai de A (unico por token)
    await putToken(send("PUT", tokB, { token: "ExponentPushToken[zzNOVO]" }));
    expect((await prisma.mobileDevice.findUniqueOrThrow({ where: { id: devA } })).pushToken).toBeNull();
    expect((await prisma.mobileDevice.findUniqueOrThrow({ where: { id: devB } })).pushToken).toBe("ExponentPushToken[zzNOVO]");
    for (const bad of [{ token: "lixo" }, { token: 5 }, {}, { token: TOKEN_A, prefs: { x: true } }, { token: TOKEN_A, prefs: { handoff: "sim" } }]) {
      expect((await putToken(send("PUT", tokA, bad))).status, JSON.stringify(bad)).toBe(400);
    }
    // remocao
    expect((await putToken(send("PUT", tokB, { token: null }))).status).toBe(200);
    expect((await prisma.mobileDevice.findUniqueOrThrow({ where: { id: devB } })).pushToken).toBeNull();
    await putToken(send("PUT", tokA, { token: TOKEN_A }));
    expect((await delToken(send("DELETE", tokA))).status).toBe(200);
    expect((await prisma.mobileDevice.findUniqueOrThrow({ where: { id: devA } })).pushToken).toBeNull();
    await prisma.mobileDevice.update({ where: { id: devA }, data: { pushToken: TOKEN_A } });
    await prisma.mobileDevice.update({ where: { id: devB }, data: { pushToken: TOKEN_B } });
  });

  it("logout e revogacao remota apagam o pushToken (LGPD)", async () => {
    const d1 = await mkDevice("L1", { pushToken: "ExponentPushToken[zzL1]" });
    const d2 = await mkDevice("L2", { pushToken: "ExponentPushToken[zzL2]" });
    await logout(send("POST", await signAccessToken(userId, d1)));
    expect((await prisma.mobileDevice.findUniqueOrThrow({ where: { id: d1 } })).pushToken).toBeNull();
    await delDevice(send("DELETE", tokA), ctx(d2));
    const x = await prisma.mobileDevice.findUniqueOrThrow({ where: { id: d2 } });
    expect(x.revokedAt).not.toBeNull();
    expect(x.pushToken).toBeNull();
  });

  it("nao-vazamento: API de alertas nao contem PII/segredos", async () => {
    await prisma.lead.update({ where: { id: leadId }, data: { needsHuman: true, handoffAt: new Date(), handoffReason: `${LEAD_NAME} ${LEAD_EMAIL}` } });
    await prisma.whatsAppInstance.update({ where: { id: instId }, data: { status: "disconnected", disconnectedAt: new Date(), lastError: `erro ${LEAD_PHONE} https://x.io/?apikey=SEGREDO` } });
    try {
      await sweepAlerts();
      const txt = await (await listAlerts(get(tokA, "http://x/api?limit=50"))).text();
      for (const bad of [LEAD_NAME, LEAD_EMAIL, LEAD_PHONE, "SEGREDO", "apikey", TOKEN_A, TOKEN_B, "passwordHash", "refreshHash"]) expect(txt, bad).not.toContain(bad);
    } finally {
      await prisma.lead.update({ where: { id: leadId }, data: { needsHuman: false, handoffAt: null, handoffReason: null } });
      await prisma.whatsAppInstance.update({ where: { id: instId }, data: { status: "connected", disconnectedAt: null, lastError: null } });
    }
  });

  it("respostas REAIS validam contra o OpenAPI (sem x-status planned)", async () => {
    await raiseAlert({ kind: "handoff", severity: "alta", dedupeKey: "handoff:zz-oa", title: "Precisa de você", body: "b", refType: "lead", refId: leadId, link: "https://cal.example.com/x" });
    const ajv = new Ajv({ allErrors: true, unknownFormats: "ignore" });
    const schemaOf = (path: string, method: string) => (spec.paths as never as Record<string, Record<string, { responses: { "200": { content: { "application/json": { schema: object } } } } }>>)[path][method].responses["200"].content["application/json"].schema;
    const check = async (path: string, method: string, res: Response) => {
      expect(res.status, path).toBe(200);
      const v = ajv.compile({ components: spec.components, ...schemaOf(path, method) });
      const body = await res.json();
      expect(v(body), `${path}: ${JSON.stringify(v.errors)}`).toBe(true);
      return body;
    };
    const l = await check("/alerts", "get", await listAlerts(get(tokA, "http://x/api?limit=50")));
    expect(l.data.length).toBeGreaterThan(0);
    await check("/alerts/unread-count", "get", await unreadCount(get(tokA)));
    await check("/alerts/{id}/read", "post", await readOne(send("POST", tokA), ctx(l.data[0].id)));
    await check("/alerts/read-all", "post", await readAll(send("POST", tokA)));
    await check("/devices/push-token", "put", await putToken(send("PUT", tokA, { token: TOKEN_A })));
    await check("/devices/push-token", "delete", await delToken(send("DELETE", tokA)));
    await prisma.mobileDevice.update({ where: { id: devA }, data: { pushToken: TOKEN_A } });
    for (const p of ["/alerts", "/alerts/unread-count", "/alerts/read-all", "/alerts/{id}/read", "/devices/push-token"]) expect(JSON.stringify((spec.paths as Record<string, unknown>)[p])).not.toContain("planned");
  });
});

describe("retencao (AC7)", () => {
  it("remove alertas > 30 dias e dispositivos inativos; preserva recentes e ativos", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - ALERT_RETENTION_MS - 1000);
    const base = { kind: "scheduler_stale", severity: "alta", title: "t", body: "b", refType: "scheduler" };
    await prisma.mobileAlert.createMany({ data: [{ ...base, dedupeKey: "zz-old", createdAt: old, resolvedAt: new Date() }, { ...base, dedupeKey: "zz-old-active", createdAt: old }, { ...base, dedupeKey: "zz-new", createdAt: new Date(now.getTime() - 29 * 24 * 3600_000) }] });
    const dOld = await mkDevice("old", { revokedAt: old });
    const dExp = await mkDevice("exp", { refreshExpiresAt: old });
    const dRecent = await mkDevice("rec", { revokedAt: new Date() });
    await cleanupMobile(now);
    const keys = (await prisma.mobileAlert.findMany({ select: { dedupeKey: true } })).map((a) => a.dedupeKey);
    expect(keys).toContain("zz-new");
    expect(keys).not.toContain("zz-old");
    expect(keys).toContain("zz-old-active"); // L1: episodio continuo nao e apagado (evita recriar com novo push)
    expect(keys).toContain(BASELINE_KEY);
    const ids = (await prisma.mobileDevice.findMany({ where: { userId }, select: { id: true } })).map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining([devA, devB, dRecent]));
    expect(ids).not.toContain(dOld);
    expect(ids).not.toContain(dExp);
  });
});

describe("baseline e push fora do caminho critico (M1)", () => {
  const okAdapter = (calls: { n: number }): AxiosAdapter => async (config: InternalAxiosRequestConfig) => {
    calls.n++;
    return { data: { data: [{ status: "ok" }, { status: "ok" }] }, status: 200, statusText: "OK", headers: {}, config };
  };
  const fakeClient = (adapter: AxiosAdapter) => createHttpClient({ name: "t", baseURL: "https://exp.test", adapter, retry: { maxAttempts: 1 } });

  it("primeira varredura: 50+ handoffs e instancia desconectada => 0 pushes, alertas nascem lidos; depois novo evento => push", async () => {
    await cleanAlerts(); // sem linha de baseline = primeira varredura
    process.env.MOBILE_PUSH_ENABLED = "true";
    const calls = { n: 0 };
    _setExpoClient(fakeClient(okAdapter(calls)));
    const leads = await prisma.lead.createManyAndReturn({ data: Array.from({ length: 55 }, (_, i) => ({ campaignId: campId, name: `zz-bl-${i}`, needsHuman: true, handoffAt: new Date(Date.now() - 86400_000 - i) })), select: { id: true } });
    await prisma.whatsAppInstance.update({ where: { id: instId }, data: { status: "disconnected", disconnectedAt: new Date(Date.now() - 86400_000) } });
    try {
      await sweepAlerts();
      expect(calls.n).toBe(0);
      expect(await prisma.mobileAlert.count({ where: { readAt: null } })).toBe(0);
      expect(await prisma.mobileAlert.count({ where: { kind: "handoff" } })).toBe(50);
      _resetSweepThrottle();
      await prisma.lead.update({ where: { id: leads[0].id }, data: { handoffAt: new Date() } }); // novo episodio
      await sweepAlerts();
      expect(calls.n).toBe(1);
    } finally {
      await prisma.lead.deleteMany({ where: { id: { in: leads.map((l) => l.id) } } });
      await prisma.whatsAppInstance.update({ where: { id: instId }, data: { status: "connected", disconnectedAt: null } });
    }
  });

  it("no maximo 10 pushes por varredura", async () => {
    process.env.MOBILE_PUSH_ENABLED = "true";
    const calls = { n: 0 };
    _setExpoClient(fakeClient(okAdapter(calls)));
    const leads = await prisma.lead.createManyAndReturn({ data: Array.from({ length: 15 }, (_, i) => ({ campaignId: campId, name: `zz-mx-${i}`, needsHuman: true, handoffAt: new Date(Date.now() - i) })), select: { id: true } });
    try {
      await sweepAlerts();
      expect(calls.n).toBe(10);
    } finally {
      await prisma.lead.deleteMany({ where: { id: { in: leads.map((l) => l.id) } } });
    }
  });

  it("Expo lento nao atrasa a varredura alem do teto", async () => {
    process.env.MOBILE_PUSH_ENABLED = "true";
    _setExpoClient(fakeClient(() => new Promise(() => {}))); // nunca responde
    await prisma.lead.update({ where: { id: leadId }, data: { needsHuman: true, handoffAt: new Date() } });
    const t0 = Date.now();
    try {
      await sweepAlerts();
      expect(Date.now() - t0).toBeLessThan(PUSH_WAIT_CAP_MS + 1500);
    } finally {
      await prisma.lead.update({ where: { id: leadId }, data: { needsHuman: false, handoffAt: null } });
    }
  }, 15_000);
});
