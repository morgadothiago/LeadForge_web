import { describe, it, expect, vi } from "vitest";
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";
import { createHttpClient, parseRetryAfter } from "./client";
import { tooManyRequests } from "./too-many-requests";
import { AppError } from "@/lib/errors";
import { handleActionError } from "@/lib/actions/result";

type Step = { status: number; headers?: Record<string, string>; data?: unknown } | { code: string };

function fake(steps: Step[]) {
  const calls: InternalAxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = async (config) => {
    calls.push(config);
    const s = steps[Math.min(calls.length - 1, steps.length - 1)]!;
    if ("code" in s) throw new AxiosError("boom secret-apikey-123", s.code, config);
    const res = { data: s.data ?? { ok: true }, status: s.status, statusText: "", headers: s.headers ?? {}, config, request: {} };
    if (s.status >= 200 && s.status < 300) return res;
    throw new AxiosError(`Request failed ${s.status}`, "ERR_BAD_RESPONSE", config, {}, res);
  };
  return { adapter, calls };
}

function mk(steps: Step[], extra: Partial<Parameters<typeof createHttpClient>[0]> = {}) {
  const f = fake(steps);
  const sleeps: number[] = [];
  const logs: unknown[] = [];
  const client = createHttpClient({
    name: "WhatsApp (Evolution)",
    adapter: f.adapter,
    headers: { apikey: "secret-apikey-123", Authorization: "Bearer tok-999" },
    retry: { sleep: async (ms) => void sleeps.push(ms), random: () => 1, baseDelayMs: 100, maxDelayMs: 5000 },
    logger: (m, meta) => logs.push([m, meta]),
    ...extra,
  });
  return { client, sleeps, logs, calls: f.calls };
}

const fail = async (p: Promise<unknown>) => (await p.then(() => null, (e) => e)) as AppError;

describe("http client", () => {
  it("429 com Retry-After em segundos", async () => {
    const { client, sleeps, calls } = mk([{ status: 429, headers: { "retry-after": "2" } }, { status: 200 }]);
    await client.get("/x");
    expect(sleeps).toEqual([2000]);
    expect(calls).toHaveLength(2);
  });
  it("429 com Retry-After em data HTTP", async () => {
    const d = new Date(Date.now() + 4500).toUTCString();
    const { client, sleeps } = mk([{ status: 429, headers: { "retry-after": d } }, { status: 200 }]);
    await client.get("/x");
    expect(sleeps[0]).toBeGreaterThanOrEqual(3000);
    expect(sleeps[0]).toBeLessThanOrEqual(5000);
    expect(parseRetryAfter("abc")).toBeUndefined();
  });
  it("Retry-After respeita teto", async () => {
    const { client, sleeps } = mk([{ status: 429, headers: { "retry-after": "999" } }, { status: 200 }]);
    await client.get("/x");
    expect(sleeps).toEqual([5000]);
  });
  it("429 sem header usa backoff exponencial", async () => {
    const { client, sleeps } = mk([{ status: 429 }, { status: 429 }, { status: 200 }]);
    await client.get("/x");
    expect(sleeps).toEqual([100, 200]);
  });
  it("tentativas esgotadas -> rate_limited PT-BR com retryAfterSeconds", async () => {
    const { client, calls } = mk([{ status: 429, headers: { "retry-after": "1" } }]);
    const e = await fail(client.get("/x"));
    expect(e).toBeInstanceOf(AppError);
    expect(e.code).toBe("rate_limited");
    expect(e.retryAfterSeconds).toBe(1);
    expect(e.userMessage).toContain("WhatsApp (Evolution)");
    expect(e.userMessage).toMatch(/Tente novamente/);
    expect(calls).toHaveLength(3);
  });
  it("5xx com retry e sucesso na 2a", async () => {
    const { client, calls } = mk([{ status: 503 }, { status: 200, data: { a: 1 } }]);
    const r = await client.get("/x");
    expect(r.data).toEqual({ a: 1 });
    expect(calls).toHaveLength(2);
  });
  it("5xx persistente -> upstream", async () => {
    const { client } = mk([{ status: 500 }]);
    expect((await fail(client.get("/x"))).code).toBe("upstream");
  });
  it.each([
    [400, "validation"], [401, "unauthorized"], [403, "forbidden"], [404, "not_found"], [409, "conflict"], [422, "validation"],
  ])("4xx %i sem retry", async (status, code) => {
    const { client, calls } = mk([{ status }]);
    const e = await fail(client.get("/x"));
    expect(e.code).toBe(code);
    expect(calls).toHaveLength(1);
  });
  it("timeout", async () => {
    const { client, calls } = mk([{ code: "ECONNABORTED" }]);
    const e = await fail(client.get("/x"));
    expect(e.code).toBe("timeout");
    expect(e.userMessage).toContain("demorou para responder");
    expect(calls).toHaveLength(3);
  });
  it.each(["ECONNREFUSED", "ENOTFOUND"])("%s -> network", async (code) => {
    const { client } = mk([{ code }]);
    const e = await fail(client.get("/x"));
    expect(e.code).toBe("network");
    expect(e.retryable).toBe(true);
  });
  it("POST não idempotente NÃO repete; com idempotent:true repete", async () => {
    const a = mk([{ status: 503 }, { status: 200 }]);
    expect((await fail(a.client.post("/x", {}))).code).toBe("upstream");
    expect(a.calls).toHaveLength(1);
    const b = mk([{ status: 503 }, { status: 200 }]);
    await b.client.post("/x", {}, { idempotent: true });
    expect(b.calls).toHaveLength(2);
  });
  it("AppError -> handleActionError -> _form PT-BR", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = mk([{ status: 404 }]);
    const e = await fail(client.get("/x"));
    const r = handleActionError(e);
    expect(r).toEqual({ ok: false, errors: { _form: [e.userMessage] } });
    spy.mockRestore();
  });
  it("sem vazamento de apikey/Authorization/corpo", async () => {
    const { client, logs } = mk([{ status: 500, data: { detail: "CORPO-CRU-SECRETO" } }, { status: 500, data: { detail: "CORPO-CRU-SECRETO" } }, { status: 500 }]);
    const e = await fail(client.get("/x?apikey=secret-apikey-123"));
    const blob = JSON.stringify([e.userMessage, e.message, logs]);
    for (const s of ["secret-apikey-123", "tok-999", "Bearer", "CORPO-CRU-SECRETO"]) expect(blob).not.toContain(s);
    expect(logs.length).toBe(2);
  });
});

describe("tooManyRequests", () => {
  it("429 + Retry-After + JSON PT-BR", async () => {
    const r = tooManyRequests(12);
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBe("12");
    const body = await r.json();
    expect(body.message).toMatch(/Muitas requisições/);
    expect(body.retryAfterSeconds).toBe(12);
  });
});
