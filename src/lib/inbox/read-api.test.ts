import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");

import { prisma } from "@/lib/prisma";
import { signInAs, signOut } from "@/lib/auth/test-helpers";
import { dropInboxOrg, mkConversation, mkInboxOrg, mkLeadIn, type InboxOrg } from "@/lib/test-utils/inbox-fixture";
import { ensureTestPlan, setTrial } from "@/lib/test-utils/trial-fixture";
import { GET as listGET } from "@/app/api/inbox/conversations/route";
import { GET as detailGET } from "@/app/api/inbox/conversations/[id]/route";
import { GET as messagesGET } from "@/app/api/inbox/conversations/[id]/messages/route";
import { GET as unreadGET } from "@/app/api/inbox/unread-count/route";
import { _resetInboxReadLimit, READ_LIMIT_PER_MINUTE } from "./http";

/** SPEC-068a: Route Handlers GET (cursor, since, isolamento A/B, 401/403/404 uniformes, 429, no-store). */
let A: InboxOrg;
let B: InboxOrg;
const BASE = "http://app.test/api/inbox";

const req = (path: string) => new Request(`${BASE}${path}`);
const list = (qs = "") => listGET(req(`/conversations${qs}`));
const detail = (id: string) => detailGET(req(`/conversations/${id}`), { params: Promise.resolve({ id }) });
const msgs = (id: string, qs = "") => messagesGET(req(`/conversations/${id}/messages${qs}`), { params: Promise.resolve({ id }) });
const body = async (r: Response) => r.json();

async function addMsgs(org: InboxOrg, conversationId: string, n: number, at = new Date("2026-06-10T12:00:00Z"), tag = "m") {
  await prisma.waMessage.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      orgId: org.orgId, conversationId, whatsappInstanceId: org.instanceId, direction: "inbound" as const, origin: "lead" as const, body: `${tag}${i}`, externalId: `${tag}-${conversationId.slice(0, 6)}-${i}-${randomUUID()}`,
      status: "delivered" as const, messageAt: at, // mesmo messageAt: empate total, ordem por id
    })),
  });
}

beforeAll(async () => {
  A = await mkInboxOrg("rda");
  B = await mkInboxOrg("rdb");
}, 30000);
afterAll(async () => {
  signOut();
  await dropInboxOrg(A);
  await dropInboxOrg(B);
});
beforeEach(async () => {
  _resetInboxReadLimit();
  signOut();
  for (const o of [A, B]) {
    await prisma.waMessage.deleteMany({ where: { orgId: o.orgId } });
    await prisma.waConversation.deleteMany({ where: { orgId: o.orgId } });
    await prisma.subscription.deleteMany({ where: { orgId: o.orgId } });
  }
});

describe("autenticação", () => {
  it("sem sessão = 401 em todas as rotas; platform_admin = 403 (sem acesso às caixas); no-store", async () => {
    const id = randomUUID();
    for (const r of [await list(), await detail(id), await msgs(id), await unreadGET()]) {
      expect(r.status).toBe(401);
      expect(r.headers.get("Cache-Control")).toBe("no-store");
    }
    const admin = await prisma.user.create({ data: { name: "zz adm", email: `zz-adm-${randomUUID()}@test.local`, role: "platform_admin" } });
    await signInAs(admin.id, { orgId: null, platformRole: "platform_admin" });
    expect((await list()).status).toBe(403);
    expect((await msgs(id)).status).toBe(403);
    expect((await unreadGET()).status).toBe(403);
    await prisma.user.delete({ where: { id: admin.id } });
  });

  it("trial expirado = 403 trial_expired", async () => {
    await ensureTestPlan("zz-inbox-plan", {});
    await setTrial(A.orgId, "zz-inbox-plan", true);
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    const r = await list();
    expect(r.status).toBe(403);
    expect((await body(r)).error.code).toBe("trial_expired");
  });

  it("owner e member leem as conversas da org", async () => {
    const lead = await mkLeadIn(A);
    await mkConversation(A, { leadId: lead.id, phone: lead.phone! });
    for (const uid of [A.userId, A.memberUserId]) {
      await signInAs(uid, { orgId: A.orgId, platformRole: "provider" });
      expect((await body(await list())).data).toHaveLength(1);
    }
  });

  it("429 + Retry-After ao passar do teto de leituras por minuto", async () => {
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    let last = new Response();
    for (let i = 0; i <= READ_LIMIT_PER_MINUTE; i++) last = await unreadGET();
    expect(last.status).toBe(429);
    expect(Number(last.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  });
});

describe("isolamento A/B (por rota)", () => {
  it("org A não lista, não lê, não vê detalhe nem conta não lidas da org B (404 uniforme)", async () => {
    const lb = await mkLeadIn(B, { name: "Lead da B" });
    const cb = await mkConversation(B, { leadId: lb.id, phone: lb.phone!, unreadCount: 4 });
    await addMsgs(B, cb.id, 3);
    const la = await mkLeadIn(A);
    await mkConversation(A, { leadId: la.id, phone: la.phone!, unreadCount: 1 });
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    const l = await body(await list());
    expect(l.data).toHaveLength(1);
    expect(JSON.stringify(l)).not.toContain("Lead da B");
    for (const r of [await detail(cb.id), await msgs(cb.id), await msgs(cb.id, `?since=${Buffer.from("0|" + randomUUID()).toString("base64url")}`), await detail(randomUUID()), await detail("nao-e-uuid")]) {
      expect(r.status).toBe(404);
      expect(await body(r)).toEqual({ error: { code: "not_found", message: "Conversa não encontrada." } }); // mesma resposta para inexistente e de outra org
    }
    expect((await body(await unreadGET())).data).toEqual({ unreadMessages: 1, unreadConversations: 1 });
    // busca por parte do nome da B não acha nada na A
    expect((await body(await list("?q=Lead%20da%20B"))).data).toHaveLength(0);
  });

  it("DTO não vaza orgId, externalId nem telefone completo", async () => {
    const lead = await mkLeadIn(A);
    const c = await mkConversation(A, { leadId: lead.id, phone: lead.phone! });
    await addMsgs(A, c.id, 1);
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    const out = JSON.stringify([await body(await list()), await body(await detail(c.id)), await body(await msgs(c.id))]);
    expect(out).not.toContain(A.orgId);
    expect(out).not.toContain(lead.phone!);
    expect(out).not.toContain("externalId");
  });
});

describe("lista", () => {
  it("ordena por lastMessageAt desc, pagina por cursor sem repetir, filtra status/busca e limita a 50", async () => {
    const t0 = new Date("2026-06-10T12:00:00Z").getTime();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const lead = await mkLeadIn(A, { name: i === 2 ? "Maria Especial" : `Lead ${i}`, company: i === 3 ? "Acme Ltda" : null });
      // i=0 e i=1 empatam em lastMessageAt
      const c = await mkConversation(A, { leadId: lead.id, phone: lead.phone!, lastMessageAt: new Date(t0 + Math.max(i - 1, 0) * 1000), status: i === 4 ? "closed" : i === 1 ? "attending" : "waiting" });
      ids.push(c.id);
    }
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    const p1 = await body(await list("?limit=2"));
    expect(p1.data).toHaveLength(2);
    expect(p1.meta.nextCursor).toBeTruthy();
    const seen = [...p1.data.map((c: { id: string }) => c.id)];
    let cursor = p1.meta.nextCursor as string | null;
    while (cursor) {
      const p = await body(await list(`?limit=2&cursor=${cursor}`));
      seen.push(...p.data.map((c: { id: string }) => c.id));
      cursor = p.meta.nextCursor;
    }
    expect(new Set(seen).size).toBe(5);
    expect(seen).toHaveLength(5);
    expect(seen[0]).toBe(ids[4]); // a mais recente
    expect((await body(await list("?status=closed"))).data).toHaveLength(1);
    expect((await body(await list("?status=attending"))).data).toHaveLength(1);
    expect((await body(await list("?status=waiting"))).data).toHaveLength(3);
    expect((await body(await list("?q=maria"))).data).toHaveLength(1);
    expect((await body(await list("?q=acme"))).data).toHaveLength(1);
    expect((await list("?limit=0")).status).toBe(400);
    expect((await list("?status=xx")).status).toBe(400);
    expect((await list("?cursor=lixo")).status).toBe(400);
  });

  it("aba Aguardando exclui conversa só com mensagens automáticas (lead nunca escreveu); 'Todas' inclui (Q-068-6)", async () => {
    const lead = await mkLeadIn(A);
    await mkConversation(A, { leadId: lead.id, phone: lead.phone!, lastInboundAt: null });
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    expect((await body(await list("?status=waiting"))).data).toHaveLength(0);
    expect((await body(await list())).data).toHaveLength(1);
  });

  it("sem N+1: uma única consulta de conversas (lead/instância vêm por include)", async () => {
    for (let i = 0; i < 6; i++) {
      const lead = await mkLeadIn(A);
      await mkConversation(A, { leadId: lead.id, phone: lead.phone! });
    }
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    const conv = vi.spyOn(prisma.waConversation, "findMany");
    const lead = vi.spyOn(prisma.lead, "findMany");
    const inst = vi.spyOn(prisma.whatsAppInstance, "findUnique");
    expect((await body(await list())).data).toHaveLength(6);
    expect(conv).toHaveBeenCalledTimes(1);
    expect(lead).not.toHaveBeenCalled();
    expect(inst).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("replyBlockedReason: janela, opt-out e instância (relógio do servidor)", async () => {
    const okLead = await mkLeadIn(A);
    const old = await mkLeadIn(A);
    const opted = await mkLeadIn(A, { optedOutAt: new Date() });
    const c1 = await mkConversation(A, { leadId: okLead.id, phone: okLead.phone!, lastInboundAt: new Date() });
    const c2 = await mkConversation(A, { leadId: old.id, phone: old.phone!, lastInboundAt: new Date(Date.now() - 25 * 3600_000) });
    const c3 = await mkConversation(A, { leadId: opted.id, phone: opted.phone!, lastInboundAt: new Date() });
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    const by = Object.fromEntries((await body(await list())).data.map((c: { id: string; replyBlockedReason: string | null }) => [c.id, c.replyBlockedReason]));
    expect(by).toEqual({ [c1.id]: null, [c2.id]: "conversation_window_closed", [c3.id]: "opted_out" });
    await prisma.whatsAppInstance.update({ where: { id: A.instanceId }, data: { status: "disconnected" } });
    expect((await body(await detail(c1.id))).data.replyBlockedReason).toBe("instance_unavailable");
    await prisma.whatsAppInstance.update({ where: { id: A.instanceId }, data: { status: "connected" } });
    await prisma.suppression.create({ data: { orgId: A.orgId, kind: "phone", value: okLead.phone!, reason: "manual" } });
    expect((await body(await detail(c1.id))).data.replyBlockedReason).toBe("opted_out"); // supressão global só no detalhe
    await prisma.suppression.deleteMany({ where: { orgId: A.orgId } });
  });
});

describe("mensagens", () => {
  it("paginação por cursor estável com empate de messageAt: before percorre tudo sem repetir nem perder; ordem cronológica", async () => {
    const lead = await mkLeadIn(A);
    const c = await mkConversation(A, { leadId: lead.id, phone: lead.phone! });
    await addMsgs(A, c.id, 7, new Date("2026-06-10T12:00:00Z"), "a");
    await addMsgs(A, c.id, 5, new Date("2026-06-10T12:05:00Z"), "b");
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    const p1 = await body(await msgs(c.id, "?limit=5"));
    expect(p1.data).toHaveLength(5);
    expect(p1.data.every((m: { body: string }) => m.body.startsWith("b"))).toBe(true);
    const all: { id: string; body: string; messageAt: string }[] = [...p1.data];
    let before = p1.meta.nextBefore as string | null;
    while (before) {
      const p = await body(await msgs(c.id, `?limit=5&before=${before}`));
      all.unshift(...p.data);
      before = p.meta.nextBefore;
    }
    expect(new Set(all.map((m) => m.id)).size).toBe(12);
    expect(all).toHaveLength(12);
    const sorted = [...all].sort((x, y) => x.messageAt.localeCompare(y.messageAt));
    expect(all.map((m) => m.messageAt)).toEqual(sorted.map((m) => m.messageAt)); // cronológica
  });

  it("since devolve só as novas e statuses das enviadas; vazio rápido sem novidades", async () => {
    const lead = await mkLeadIn(A);
    const c = await mkConversation(A, { leadId: lead.id, phone: lead.phone! });
    await addMsgs(A, c.id, 2, new Date("2026-06-10T12:00:00Z"));
    const out = await prisma.waMessage.create({ data: { orgId: A.orgId, conversationId: c.id, whatsappInstanceId: A.instanceId, direction: "outbound", origin: "manual", body: "resp", status: "sent", messageAt: new Date("2026-06-10T12:01:00Z") } });
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    const first = await body(await msgs(c.id));
    expect(first.data).toHaveLength(3);
    const since = first.meta.nextSince as string;
    const none = await body(await msgs(c.id, `?since=${since}`));
    expect(none.data).toEqual([]);
    expect(none.meta.nextSince).toBe(since);
    expect(none.meta.statuses).toEqual([{ id: out.id, status: "sent", error: null }]);
    await prisma.waMessage.update({ where: { id: out.id }, data: { status: "read" } });
    await addMsgs(A, c.id, 1, new Date("2026-06-10T12:02:00Z"), "n");
    const news = await body(await msgs(c.id, `?since=${since}`));
    expect(news.data.map((m: { body: string }) => m.body)).toEqual(["n0"]);
    expect(news.meta.statuses).toEqual([]); // `read` é final: sai da lista de acompanhamento
    expect((await msgs(c.id, `?since=${since}&before=${since}`)).status).toBe(400);
    expect((await msgs(c.id, "?since=lixo")).status).toBe(400);
  });

  it("limit máximo 50", async () => {
    const lead = await mkLeadIn(A);
    const c = await mkConversation(A, { leadId: lead.id, phone: lead.phone! });
    await addMsgs(A, c.id, 60);
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    expect((await body(await msgs(c.id, "?limit=500"))).data).toHaveLength(50);
    expect((await msgs(c.id, "?limit=abc")).status).toBe(400);
  });
});

describe("não lidas", () => {
  it("soma por org, ignora encerradas", async () => {
    for (const [unread, status] of [[2, "waiting"], [3, "attending"], [9, "closed"]] as const) {
      const lead = await mkLeadIn(A);
      await mkConversation(A, { leadId: lead.id, phone: lead.phone!, unreadCount: unread, status });
    }
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    expect((await body(await unreadGET())).data).toEqual({ unreadMessages: 5, unreadConversations: 2 });
  });
});
