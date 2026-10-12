import { afterEach, describe, expect, it, vi } from "vitest";
import { conversationsUrl, fetchConversations, fetchMessages, fetchUnread, toOutcome } from "./client-api";

afterEach(() => vi.unstubAllGlobals());
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init });

describe("client-api", () => {
  it("monta a URL com status, busca (cortada em 100), cursor e limite", () => {
    expect(conversationsUrl({ status: "waiting", q: " ana ", cursor: "abc" })).toBe("/api/inbox/conversations?status=waiting&q=ana&cursor=abc&limit=30");
    expect(conversationsUrl({ q: "x".repeat(300) })).toContain(`q=${"x".repeat(100)}&`);
    expect(conversationsUrl({})).toBe("/api/inbox/conversations?limit=30");
  });
  it("lista: lê data + meta.nextCursor, no-store", async () => {
    const f = vi.fn(async () => json({ data: [{ id: "1" }], meta: { nextCursor: "c2" } }));
    vi.stubGlobal("fetch", f);
    const r = await fetchConversations({});
    expect(r).toMatchObject({ ok: true, items: [{ id: "1" }], nextCursor: "c2" });
    expect((f.mock.calls[0] as unknown[])[1]).toMatchObject({ cache: "no-store" });
  });
  it("429 devolve Retry-After em ms; 401/404 viram status; rede vira status 0 (nunca lanca)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: {} }, { status: 429, headers: { "Retry-After": "7" } })));
    expect(await fetchUnread()).toEqual({ ok: false, status: 429, retryAfterMs: 7000 });
    expect(toOutcome({ ok: false, retryAfterMs: 7000 })).toEqual({ ok: false, retryAfterMs: 7000 });
    vi.stubGlobal("fetch", vi.fn(async () => json({}, { status: 404 })));
    expect(await fetchMessages("00000000-0000-4000-8000-000000000000", {})).toMatchObject({ ok: false, status: 404 });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("net"); }));
    expect(await fetchUnread()).toEqual({ ok: false, status: 0 });
  });
  it("mensagens: since/before e meta (statuses, nextSince)", async () => {
    const f = vi.fn(async () => json({ data: [{ id: "m" }], meta: { nextBefore: null, nextSince: "s", hasMore: false, statuses: [{ id: "m", status: "read", error: null }] } }));
    vi.stubGlobal("fetch", f);
    const r = await fetchMessages("c1", { since: "S" });
    expect(f.mock.calls[0]).toBeDefined();
    expect((f.mock.calls[0] as unknown[])[0]).toBe("/api/inbox/conversations/c1/messages?since=S&limit=30");
    expect(r).toMatchObject({ ok: true, nextSince: "s", statuses: [{ status: "read" }] });
  });
  it("resposta fora do formato vira falha (nao quebra a tela)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: { nope: true } })));
    expect(await fetchConversations({})).toEqual({ ok: false, status: 0 });
    expect(await fetchUnread()).toEqual({ ok: false, status: 0 });
  });
});
