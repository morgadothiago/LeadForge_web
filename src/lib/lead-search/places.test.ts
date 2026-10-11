import { describe, it, expect } from "vitest";
import { AxiosError, type AxiosAdapter } from "axios";
import { AppError } from "@/lib/errors";
import { createPlacesClient, PlacesSource, queryVariants } from "./places";
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

describe("SPEC-060 paginacao", () => {
  const page = (ids: string[], next?: string) => ({ status: 200, data: { places: ids.map((id) => ({ id, displayName: { text: id } })), ...(next ? { nextPageToken: next } : {}) } });
  function spy(steps: Step[]) {
    const bodies: Record<string, unknown>[] = [];
    const adapter: AxiosAdapter = async (config) => {
      bodies.push(JSON.parse(String(config.data)));
      const s = steps[Math.min(bodies.length - 1, steps.length - 1)]!;
      const res = { data: (s as { data?: unknown }).data ?? {}, status: (s as { status: number }).status, statusText: "", headers: {}, config, request: {} };
      if (res.status < 300) return res;
      throw new AxiosError("fail", "ERR_BAD_RESPONSE", config, {}, res);
    };
    return { src: new PlacesSource(createPlacesClient("KEY-SECRET", adapter)), bodies };
  }
  const icp2 = { niche: "clinica", location: "Recife", keywords: ["dentista", "estetica"] };

  it("progress.requests reflete as 2 chamadas mesmo quando a 2a falha (400 e depois 5xx)", async () => {
    const { src } = spy([{ status: 400 }, { status: 503 }]);
    const progress = { requests: 0 };
    await expect(src.search(icp2, 20, undefined, { cursor: { variant: 0, pageToken: "OLD", query: "clinica dentista estetica Recife" }, maxRequests: 2, progress })).rejects.toBeDefined();
    expect(progress.requests).toBe(2);
  });
  it("AC-1: 1a busca sem pageToken devolve cursor com nextPageToken", async () => {
    const { src, bodies } = spy([page(["a"], "T1")]);
    const r = await src.search(icp2, 20);
    expect(bodies[0]).not.toHaveProperty("pageToken");
    expect(r.cursor).toEqual({ variant: 0, pageToken: "T1", query: "clinica dentista estetica Recife" });
  });
  it("AC-2: busca seguinte envia pageToken + mesmo textQuery", async () => {
    const { src, bodies } = spy([page(["b"], "T2")]);
    const r = await src.search(icp2, 20, undefined, { cursor: { variant: 0, pageToken: "T1", query: "clinica dentista estetica Recife" } });
    expect(bodies[0]).toMatchObject({ pageToken: "T1", textQuery: "clinica dentista estetica Recife" });
    expect(r.cursor?.pageToken).toBe("T2");
    expect(r.requests).toBe(1);
  });
  it("AC-3: sem proximo token => proxima busca usa a proxima variacao", async () => {
    const m = spy([page(["a"])]);
    const r1 = await m.src.search(icp2, 20);
    expect(r1.cursor?.pageToken).toBeNull();
    const m2 = spy([page(["z"])]);
    const r2 = await m2.src.search(icp2, 20, undefined, { cursor: r1.cursor });
    expect(m2.bodies[0]).toMatchObject({ textQuery: "clinica dentista Recife" });
    expect(m2.bodies[0]).not.toHaveProperty("pageToken");
    expect(r2.cursor?.variant).toBe(1);
  });
  it("AC-4: token invalido (400) com orcamento 2 refaz na proxima variacao", async () => {
    const m = spy([{ status: 400 }, page(["n"], "N1")]);
    const r = await m.src.search(icp2, 20, undefined, { maxRequests: 2, cursor: { variant: 0, pageToken: "OLD", query: "clinica dentista estetica Recife" } });
    expect(r.requests).toBe(2);
    expect(m.bodies[1]).not.toHaveProperty("pageToken");
    expect(r.leads).toHaveLength(1);
    expect(r.cursor).toMatchObject({ variant: 1, pageToken: "N1" });
  });
  it("AC-4/5: token invalido com maxRequests=1 nao faz 2a chamada e avanca a variacao na proxima", async () => {
    const m = spy([{ status: 400 }]);
    const r = await m.src.search(icp2, 20, undefined, { maxRequests: 1, cursor: { variant: 0, pageToken: "OLD", query: "clinica dentista estetica Recife" } });
    expect(m.bodies).toHaveLength(1);
    expect(r).toMatchObject({ leads: [], requests: 1, cursor: { variant: 0, pageToken: null } });
    const m2 = spy([page(["x"])]);
    await m2.src.search(icp2, 20, undefined, { cursor: r.cursor });
    expect(m2.bodies[0]).toMatchObject({ textQuery: "clinica dentista Recife" });
  });
  it("AC-7: ICP alterada reinicia na variacao 0", async () => {
    const m = spy([page(["a"])]);
    await m.src.search(icp2, 20, undefined, { cursor: { variant: 2, pageToken: "T", query: "outra query" } });
    expect(m.bodies[0]).toMatchObject({ textQuery: "clinica dentista estetica Recife" });
    expect(m.bodies[0]).not.toHaveProperty("pageToken");
  });
  it("sem keywords usa sufixos genericos e sem duplicatas", () => {
    const v = queryVariants({ niche: "clinica", location: "Recife", keywords: [] });
    expect(v).toEqual(["clinica Recife", "clinica empresas Recife", "clinica serviços Recife", "clinica melhores Recife"]);
  });
  it("AC-8: erro de token invalido nao vaza a chave", async () => {
    const m = spy([{ status: 400 }]);
    const e = await fail(m.src.search(icp2, 20, undefined, { maxRequests: 1 }).then(() => Promise.reject(new Error("x")), (x) => Promise.reject(x)));
    expect(JSON.stringify(e)).not.toContain("KEY-SECRET");
  });
});
