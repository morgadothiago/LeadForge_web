import { describe, it, expect } from "vitest";
import { AxiosError, type AxiosAdapter } from "axios";
import { AppError } from "@/lib/errors";
import { createPlacesClient, PlacesSource } from "./places";
import { scoreLead } from "./score";

type Step = { status: number; headers?: Record<string, string>; data?: unknown } | { code: string };
function mk(steps: Step[]) {
  let n = 0;
  const adapter: AxiosAdapter = async (config) => {
    const s = steps[Math.min(n++, steps.length - 1)]!;
    if ("code" in s) throw new AxiosError("boom KEY-SECRET", s.code, config);
    const res = { data: s.data ?? {}, status: s.status, statusText: "", headers: s.headers ?? {}, config, request: {} };
    if (s.status < 300) return res;
    throw new AxiosError("fail", "ERR_BAD_RESPONSE", config, {}, res);
  };
  const src = new PlacesSource(createPlacesClient("KEY-SECRET", adapter));
  return { src, calls: () => n };
}
const icp = { niche: "clinica", location: "Recife", keywords: [] };
const fail = async (p: Promise<unknown>) => (await p.then(() => null, (e) => e)) as AppError;

describe("PlacesSource", () => {
  it("normaliza resultados e ignora sem nome", async () => {
    const { src } = mk([{ status: 200, data: { places: [{ id: "a", displayName: { text: "Clinica A" }, internationalPhoneNumber: "+55 81 99999-1111", websiteUri: "https://a.com" }, { id: "b" }] } }]);
    const r = await src.search(icp, 20);
    expect(r.leads).toHaveLength(1);
    expect(r.leads[0]).toMatchObject({ externalId: "a", name: "Clinica A", phone: "+55 81 99999-1111" });
    expect(r.requests).toBe(1);
  });
  it("resposta vazia => 0 leads", async () => {
    expect((await mk([{ status: 200, data: {} }]).src.search(icp, 5)).leads).toEqual([]);
  });
  it("corpo fora do formato => upstream", async () => {
    expect((await fail(mk([{ status: 200, data: { places: [{ nope: 1 }] } }]).src.search(icp, 5))).code).toBe("upstream");
  });
  it("429 com Retry-After esgota tentativas sem vazar chave", async () => {
    const m = mk([{ status: 429, headers: { "retry-after": "0" } }]);
    const e = await fail(m.src.search(icp, 5));
    expect(e.code).toBe("rate_limited");
    expect(m.calls()).toBe(3);
    expect(JSON.stringify(e.userMessage)).not.toContain("KEY-SECRET");
  });
  it("429 sem Retry-After e depois sucesso", async () => {
    const m = mk([{ status: 429 }, { status: 200, data: { places: [] } }]);
    // backoff real curto (500ms base): aceitável em teste
    expect((await m.src.search(icp, 5)).leads).toEqual([]);
    expect(m.calls()).toBe(2);
  });
  it("5xx repete e esgota", async () => {
    const m = mk([{ status: 503, headers: { "retry-after": "0" } }]);
    expect((await fail(m.src.search(icp, 5))).code).toBe("upstream");
    expect(m.calls()).toBe(3);
  });
  it("timeout", async () => {
    const e = await fail(mk([{ code: "ECONNABORTED" }]).src.search(icp, 5));
    expect(e.code).toBe("timeout");
    expect(e.userMessage).not.toContain("KEY-SECRET");
  });
  it("401 nao repete", async () => {
    const m = mk([{ status: 401 }]);
    expect((await fail(m.src.search(icp, 5))).code).toBe("unauthorized");
    expect(m.calls()).toBe(1);
  });
});

describe("scoreLead", () => {
  const base = { externalId: "x", name: "n", company: null, phone: null, email: null, website: null, address: null, rating: null, ratingCount: null };
  it("fica em 0-100 e pesa contato", () => {
    expect(scoreLead(base)).toBe(0);
    const s = scoreLead({ ...base, phone: "+5581", website: "http://a", rating: 5, ratingCount: 100000 });
    expect(s).toBeGreaterThan(60);
    expect(s).toBeLessThanOrEqual(100);
  });
});
