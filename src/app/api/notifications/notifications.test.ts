import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { signInAs, signOut } from "@/lib/auth/test-helpers";
import { mkMeetingFixture, type MeetingFixture } from "@/lib/test-utils/meeting-fixture";
import { BASELINE_KEY, sweepThrottled, _resetSweepThrottle } from "@/lib/mobile/alerts";
import { signAccessToken } from "@/lib/mobile/token";
import { GET as summary } from "./summary/route";
import { GET as list } from "./route";
import { POST as readOne } from "./[id]/read/route";
import { POST as readAll } from "./read-all/route";
import { spec } from "@/lib/openapi";

let fx: MeetingFixture;
const req = (url: string, init: RequestInit = {}) => new Request(`http://localhost${url}`, init);
const post = (url: string, body?: unknown, headers: Record<string, string> = {}) => req(url, { method: "POST", ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } } : { headers }) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const mkAlert = (kind: string, n: number, extra: Record<string, unknown> = {}) =>
  prisma.mobileAlert.create({ data: { kind, severity: "media", dedupeKey: `zz-notif:${kind}:${n}:${crypto.randomUUID()}`, title: "t", body: "b", refType: "scheduler", createdAt: new Date(Date.now() - n * 1000), ...extra } });

beforeAll(async () => {
  fx = await mkMeetingFixture("zz-test-notif");
  _resetSweepThrottle();
  await sweepThrottled(); // consome a varredura: as chamadas abaixo (< 60 s) nao criam alertas do estado real
});
beforeEach(async () => {
  await signInAs(fx.userId);
  await prisma.mobileAlert.deleteMany({});
  await prisma.mobileAlert.create({ data: { kind: "baseline", severity: "baixa", dedupeKey: BASELINE_KEY, title: "baseline", body: "baseline", refType: "scheduler", readAt: new Date(), resolvedAt: new Date() } });
});
afterAll(async () => {
  signOut();
  await prisma.mobileAlert.deleteMany({});
  await fx.cleanup();
  await prisma.$disconnect();
});

describe("auth: sessao obrigatoria (nao Bearer mobile)", () => {
  it("401 JSON sem cookie em todas as rotas", async () => {
    signOut();
    const rs = [await summary(req("/api/notifications/summary")), await list(req("/api/notifications")), await readOne(post("/api/notifications/x/read"), ctx(crypto.randomUUID())), await readAll(post("/api/notifications/read-all"))];
    for (const r of rs) {
      expect(r.status).toBe(401);
      expect(r.headers.get("location")).toBeNull();
      expect((await r.json()).error.code).toBe("unauthorized");
    }
  });
  it("token mobile (Bearer) nao autentica", async () => {
    signOut();
    const dev = await prisma.mobileDevice.create({ data: { userId: fx.userId, name: "zz", platform: "ios", refreshHash: `h-${crypto.randomUUID()}`, refreshExpiresAt: new Date(Date.now() + 1e9) } });
    const t = await signAccessToken(fx.userId, dev.id);
    expect((await summary(req("/api/notifications/summary", { headers: { authorization: `Bearer ${t}` } }))).status).toBe(401);
    await prisma.mobileDevice.delete({ where: { id: dev.id } });
  });
  it("POST de outra origem = 403", async () => {
    const r = await readAll(post("/api/notifications/read-all", undefined, { origin: "https://evil.example" }));
    expect(r.status).toBe(403);
  });
});

describe("GET /api/notifications/summary", () => {
  it("totais por area; kind desconhecido so no total; aprovacoes = drafts pendentes; sem PII", async () => {
    await mkAlert("meeting_reminder", 1);
    await mkAlert("meeting_reminder", 2);
    await mkAlert("handoff", 3);
    await mkAlert("wa_paused", 4);
    await mkAlert("kind_futuro", 5);
    await mkAlert("handoff", 6, { readAt: new Date() }); // lida nao conta
    const r = await summary(req("/api/notifications/summary"));
    expect(r.status).toBe(200);
    const { data } = await r.json();
    const pending = await prisma.draft.count({ where: { status: "pending" } });
    expect(data).toEqual({ unreadTotal: 5, byArea: { calendario: 2, leads: 1, configuracoes: 1, aprovacoes: pending } });
    expect(r.headers.get("cache-control")).toContain("no-cache");
  });

  it("ETag e 304 com If-None-Match igual; muda quando o estado muda", async () => {
    await mkAlert("handoff", 1);
    const a = await summary(req("/api/notifications/summary"));
    const etag = a.headers.get("etag")!;
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
    const b = await summary(req("/api/notifications/summary", { headers: { "if-none-match": etag } }));
    expect(b.status).toBe(304);
    expect(await b.text()).toBe("");
    expect((await summary(req("/api/notifications/summary", { headers: { "if-none-match": `W/${etag}` } }))).status).toBe(304);
    await mkAlert("handoff", 2);
    const c = await summary(req("/api/notifications/summary", { headers: { "if-none-match": etag } }));
    expect(c.status).toBe(200);
    expect(c.headers.get("etag")).not.toBe(etag);
  });
});

describe("GET /api/notifications", () => {
  it("cursor createdAt,id sem repetir nem pular; ordem desc; sem baseline; campo area", async () => {
    for (let i = 1; i <= 5; i++) await mkAlert(i % 2 ? "handoff" : "meeting_reminder", i);
    const p1 = await (await list(req("/api/notifications?limit=2"))).json();
    expect(p1.data).toHaveLength(2);
    expect(p1.meta.nextCursor).toBeTruthy();
    const p2 = await (await list(req(`/api/notifications?limit=2&cursor=${p1.meta.nextCursor}`))).json();
    const p3 = await (await list(req(`/api/notifications?limit=2&cursor=${p2.meta.nextCursor}`))).json();
    const all = [...p1.data, ...p2.data, ...p3.data];
    expect(all).toHaveLength(5);
    expect(new Set(all.map((x: { id: string }) => x.id)).size).toBe(5);
    expect(p3.meta.nextCursor).toBeNull();
    const times = all.map((x: { createdAt: string }) => Date.parse(x.createdAt));
    expect([...times].sort((x, y) => y - x)).toEqual(times);
    expect(all.some((x: { kind: string }) => x.kind === "baseline")).toBe(false);
    expect(all[0]).toMatchObject({ area: "leads" });
  });

  it("cursor com mesmo createdAt desempata por id", async () => {
    const same = new Date(Date.now() - 5000);
    for (let i = 0; i < 4; i++) await mkAlert("handoff", 1, { createdAt: same });
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 4; i++) {
      const j: { data: { id: string }[]; meta: { nextCursor: string | null } } = await (await list(req(`/api/notifications?limit=1${cursor ? `&cursor=${cursor}` : ""}`))).json();
      seen.push(...j.data.map((x) => x.id));
      cursor = j.meta.nextCursor;
    }
    expect(new Set(seen).size).toBe(4);
  });

  it("filtros area/kind/unread e limite padrao 20", async () => {
    await mkAlert("handoff", 1);
    await mkAlert("meeting_reminder", 2, { readAt: new Date() });
    await mkAlert("wa_paused", 3);
    const j = async (q: string) => (await (await list(req(`/api/notifications?${q}`))).json()).data as { kind: string }[];
    expect((await j("area=leads")).map((x) => x.kind)).toEqual(["handoff"]);
    expect((await j("area=calendario")).map((x) => x.kind)).toEqual(["meeting_reminder"]);
    expect(await j("area=aprovacoes")).toEqual([]);
    expect((await j("kind=wa_paused")).map((x) => x.kind)).toEqual(["wa_paused"]);
    expect((await j("unread=true")).map((x) => x.kind).sort()).toEqual(["handoff", "wa_paused"]);
    expect((await j("unread=false")).map((x) => x.kind)).toEqual(["meeting_reminder"]);
    for (let i = 0; i < 25; i++) await mkAlert("handoff", 10 + i);
    expect(await j("")).toHaveLength(20);
  });

  it("entradas invalidas = 400", async () => {
    for (const q of ["limit=0", "limit=x", "cursor=lixo", "area=xyz", "unread=talvez", "kind=A;B"]) expect((await list(req(`/api/notifications?${q}`))).status, q).toBe(400);
  });
});

describe("marcar como lida", () => {
  it("read: idempotente, nao sobrescreve readAt, 404 para inexistente/baseline/id invalido; reflete no resumo", async () => {
    const a = await mkAlert("meeting_reminder", 1);
    const before = (await (await summary(req("/api/notifications/summary"))).json()).data;
    expect(before.byArea.calendario).toBe(1);
    const r1 = await readOne(post(`/api/notifications/${a.id}/read`), ctx(a.id));
    expect(r1.status).toBe(200);
    const t1 = (await r1.json()).data.readAt;
    const t2 = (await (await readOne(post(`/api/notifications/${a.id}/read`), ctx(a.id))).json()).data.readAt;
    expect(t2).toBe(t1);
    expect((await (await summary(req("/api/notifications/summary"))).json()).data.byArea.calendario).toBe(0);
    expect((await readOne(post("/api/notifications/x/read"), ctx(crypto.randomUUID()))).status).toBe(404);
    expect((await readOne(post("/api/notifications/x/read"), ctx("nao-uuid"))).status).toBe(404);
    const base = await prisma.mobileAlert.findUniqueOrThrow({ where: { dedupeKey: BASELINE_KEY } });
    expect((await readOne(post("/api/notifications/x/read"), ctx(base.id))).status).toBe(404);
  });

  it("read-all total e por area; corpo vazio ok; area invalida 400", async () => {
    await mkAlert("handoff", 1);
    await mkAlert("meeting_reminder", 2);
    await mkAlert("wa_paused", 3);
    expect((await readAll(post("/api/notifications/read-all", { area: "nada" }))).status).toBe(400);
    expect((await readAll(post("/api/notifications/read-all"))).status).toBe(200); // sem corpo
    // (o primeiro POST sem corpo ja marcou tudo)
    expect((await (await summary(req("/api/notifications/summary"))).json()).data.unreadTotal).toBe(0);
    await mkAlert("handoff", 4);
    await mkAlert("meeting_reminder", 5);
    const r = await (await readAll(post("/api/notifications/read-all", { area: "calendario" }))).json();
    expect(r.data.updated).toBe(1);
    const s = (await (await summary(req("/api/notifications/summary"))).json()).data;
    expect(s.byArea.calendario).toBe(0);
    expect(s.byArea.leads).toBe(1);
    expect((await (await readAll(post("/api/notifications/read-all"))).json()).data.updated).toBe(1);
  });
});

describe("openapi", () => {
  it("documenta rotas de sessao, webhook e o kind meeting_reminder", () => {
    const paths = Object.keys(spec.paths ?? {});
    for (const p of ["/notifications/summary", "/notifications", "/notifications/{id}/read", "/notifications/read-all", "/integrations/meetings"]) expect(paths).toContain(p);
    expect(JSON.stringify(spec)).toContain("meeting_reminder");
  });
});
