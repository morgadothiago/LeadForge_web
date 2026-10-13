import { describe, it, expect, vi, beforeEach } from "vitest";

const p = vi.hoisted(() => ({
  campaign: { findUnique: vi.fn(), findMany: vi.fn() },
  searchRun: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
  lead: { update: vi.fn(), findFirst: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));
p.$transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(p));
vi.mock("@/lib/prisma", () => ({ prisma: p }));
const processItem = vi.hoisted(() => vi.fn());
vi.mock("@/lib/lead-ingest/handler", () => ({ processItem }));
// SPEC-069b: o limite de buscas por dia do PLANO e testado com banco real (entitlements-069b.test.ts); aqui o plano e ilimitado.
vi.mock("@/lib/billing/entitlements", () => ({ getEntitlements: vi.fn(async () => ({ limits: { maxLeadSearchesPerDay: null } })) }));
vi.mock("@/lib/integrations/config", () => ({ findIntegrationConfig: vi.fn(async () => null) }));

import { runLeadSearch, runDailySearch, startLeadSearch } from "./run";
import type { LeadSource } from "./types";

const raw = (id: string, phone: string | null) => ({ externalId: id, name: id, company: id, phone, email: null, website: null, address: null, rating: 4, ratingCount: 10 });
const source = (leads: ReturnType<typeof raw>[]): LeadSource => ({ id: "google_places", search: vi.fn(async () => ({ leads, requests: 1 })) });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LEAD_SEARCH_ENABLED = "true";
  p.campaign.findUnique.mockResolvedValue({ id: "c", status: "active", icp: { niche: "x", location: null, keywords: [] } });
  p.searchRun.findMany.mockResolvedValue([]);
  p.searchRun.count.mockResolvedValue(0);
  p.searchRun.findFirst.mockResolvedValue(null);
  p.searchRun.updateMany.mockResolvedValue({ count: 0 });
  p.searchRun.create.mockResolvedValue({ id: "r1" });
  p.lead.findFirst.mockResolvedValue(null);
  p.lead.update.mockResolvedValue({});
  p.searchRun.update.mockResolvedValue({});
  p.$transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(p));
});

describe("runLeadSearch", () => {
  it("desligada por padrao", async () => {
    delete process.env.LEAD_SEARCH_ENABLED;
    await expect(runLeadSearch("c", { source: source([]) })).rejects.toMatchObject({ code: "config" });
    expect(p.searchRun.create.mock.calls[0]![0].data).toMatchObject({ status: "blocked" });
  });
  it("sem chave places => erro de configuracao", async () => {
    await expect(runLeadSearch("c")).rejects.toMatchObject({ code: "config" });
  });
  it("respeita teto manual da campanha (2/dia por padrao)", async () => {
    p.searchRun.findMany.mockResolvedValue([{ trigger: "manual", status: "done", requests: 2 }]);
    await expect(runLeadSearch("c", { source: source([]) })).rejects.toMatchObject({ code: "rate_limited" });
    expect(p.searchRun.create.mock.calls[0]![0].data).toMatchObject({ status: "blocked" });
  });
  it("teto manual nao consome do teto diario: diaria so conta agendadas", async () => {
    p.searchRun.findMany.mockResolvedValue([{ trigger: "manual", status: "done", requests: 2 }]);
    await expect(runLeadSearch("c", { trigger: "scheduled", source: source([]) })).resolves.toMatchObject({ runId: "r1" });
  });
  it("agendado bloqueado nao grava run", async () => {
    p.searchRun.findMany.mockResolvedValue([{ trigger: "scheduled", status: "done", requests: 3 }]);
    await expect(runLeadSearch("c", { trigger: "scheduled", source: source([]) })).rejects.toMatchObject({ code: "rate_limited" });
    expect(p.searchRun.create).not.toHaveBeenCalled();
  });
  it("erro em um item nao derruba o lote e grava contadores", async () => {
    processItem.mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce({ index: 1, status: "created", leadId: "L" });
    p.lead.update.mockRejectedValueOnce(new Error("y"));
    const o = await runLeadSearch("c", { source: source([raw("a", "+5581999991111"), raw("b", "+5581999992222")]) });
    expect(o).toMatchObject({ created: 1, invalid: 1 });
    expect(p.searchRun.update.mock.calls[0]![0].data).toMatchObject({ status: "done", created: 1, invalid: 1 });
  });
  it("dedupe por externalId", async () => {
    p.lead.findFirst.mockResolvedValueOnce({ id: "x" });
    const o = await runLeadSearch("c", { source: source([raw("a", null)]) });
    expect(o.duplicate).toBe(1);
    expect(processItem).not.toHaveBeenCalled();
  });
  it("cria, deduplica, suprime e pontua", async () => {
    processItem
      .mockResolvedValueOnce({ index: 0, status: "created", leadId: "L1" })
      .mockResolvedValueOnce({ index: 1, status: "duplicate" })
      .mockResolvedValueOnce({ index: 2, status: "suppressed" })
      .mockResolvedValueOnce({ index: 3, status: "invalid" });
    const o = await runLeadSearch("c", { source: source([raw("a", "+5581999991111"), raw("b", "+5581999992222"), raw("c", "+5581999993333"), raw("d", null)]) });
    expect(o).toMatchObject({ found: 4, created: 1, duplicate: 1, suppressed: 1, invalid: 1 });
    expect(p.lead.update).toHaveBeenCalledTimes(1);
    const d = p.lead.update.mock.calls[0]![0].data;
    expect(d.score).toBeGreaterThan(0);
    expect(d.rawData).toMatchObject({ source: "google_places", legalBasis: "interesse_legitimo_b2b" });
    expect(p.searchRun.update.mock.calls[0]![0].data.status).toBe("done");
  });
  it("SPEC-065 (D-065-18): cota de leads do plano esgotada no meio do lote => PARA (parcial, run `done` com motivo), nao e erro e nao avanca o cursor", async () => {
    processItem
      .mockResolvedValueOnce({ index: 0, status: "created", leadId: "L1" })
      .mockResolvedValueOnce({ index: 1, status: "limit_reached", reason: "limite de leads do plano atingido" });
    const s = { id: "google_places", search: vi.fn(async () => ({ leads: [raw("a", "+5581999991111"), raw("b", "+5581999992222"), raw("c", "+5581999993333")], requests: 1, cursor: { variant: 1, pageToken: "next", query: "q" } })) } as LeadSource;
    const o = await runLeadSearch("c", { source: s });
    expect(o).toMatchObject({ created: 1, invalid: 0, limitReached: true });
    expect(processItem).toHaveBeenCalledTimes(2); // o 3o item nem foi tentado
    const d = p.searchRun.update.mock.calls[0]![0].data;
    expect(d).toMatchObject({ status: "done", created: 1, error: expect.stringMatching(/Limite de leads do plano/) });
    expect(d).not.toHaveProperty("pageToken"); // cursor nao avanca: depois do upgrade a busca retoma desta pagina
  });
  it("falha da fonte registra run failed", async () => {
    const s: LeadSource = { id: "google_places", search: vi.fn(async () => { throw new Error("x"); }) };
    await expect(runLeadSearch("c", { source: s })).rejects.toThrow();
    expect(p.searchRun.update.mock.calls[0]![0].data.status).toBe("failed");
  });
});

describe("SPEC-058 reserve", () => {
  it("texto de desligada nao cita env var", async () => {
    delete process.env.LEAD_SEARCH_ENABLED;
    await expect(runLeadSearch("c", { source: source([]) })).rejects.toThrow(/indisponível no momento, fale com o suporte/);
    expect(p.searchRun.create.mock.calls[0]![0].data.error).not.toMatch(/LEAD_SEARCH/);
  });
  it("teto da org (manual + diaria) bloqueia o manual e grava blocked sem chamar a fonte", async () => {
    p.searchRun.findMany
      .mockResolvedValueOnce([]) // campanha
      .mockResolvedValueOnce(Array.from({ length: 10 }, () => ({ trigger: "scheduled", status: "done", requests: 1 }))); // org
    const s = source([]);
    await expect(runLeadSearch("c", { source: s })).rejects.toMatchObject({ code: "rate_limited", userMessage: expect.stringContaining("organização") });
    expect(s.search).not.toHaveBeenCalled();
    expect(p.searchRun.create.mock.calls[0]![0].data).toMatchObject({ status: "blocked" });
  });
  it("manual com manual running: devolve o runId em andamento, sem criar run nem chamar a fonte", async () => {
    p.searchRun.findFirst.mockResolvedValue({ id: "run-ativo", trigger: "manual" });
    const s = source([]);
    await expect(startLeadSearch("c", { source: s })).resolves.toEqual({ inProgress: "run-ativo" });
    expect(s.search).not.toHaveBeenCalled();
    expect(p.searchRun.create).not.toHaveBeenCalled();
  });
  it("manual com diaria running: erro PT-BR 'Ja existe uma busca em andamento'", async () => {
    p.searchRun.findFirst.mockResolvedValue({ id: "d", trigger: "scheduled" });
    await expect(runLeadSearch("c", { source: source([]) })).rejects.toMatchObject({ code: "conflict", userMessage: expect.stringContaining("em andamento") });
    expect(p.searchRun.create).not.toHaveBeenCalled();
  });
  it("diaria com run running: pula sem consumir", async () => {
    p.searchRun.findFirst.mockResolvedValue({ id: "m", trigger: "manual" });
    p.campaign.findMany.mockResolvedValue([{ id: "c" }]);
    expect(await runDailySearch({ source: source([]) })).toEqual([]);
    expect(p.searchRun.create).not.toHaveBeenCalled();
  });
  it("marca como failed (cobrando 1) runs running mais antigos que 10 min", async () => {
    await runLeadSearch("c", { source: source([]) });
    const a = p.searchRun.updateMany.mock.calls[0]![0];
    expect(a.where).toMatchObject({ campaignId: "c", status: "running" });
    expect(Date.now() - a.where.startedAt.lt.getTime()).toBeGreaterThanOrEqual(10 * 60_000 - 1000);
    expect(a.data).toMatchObject({ status: "failed", requests: 1, error: "Execução interrompida." });
  });
  it("estourar o prazo total vira run failed com mensagem PT-BR (fonte ignora o signal)", async () => {
    const s: LeadSource = { id: "google_places", search: vi.fn(() => new Promise<never>(() => undefined)) };
    await expect(runLeadSearch("c", { source: s, timeoutMs: 20 })).rejects.toMatchObject({ code: "timeout", userMessage: expect.stringContaining("tempo limite") });
    expect(p.searchRun.update.mock.calls[0]![0].data).toMatchObject({ status: "failed", requests: 1, error: expect.stringContaining("tempo limite") });
  });
  it("passa o AbortSignal para a fonte", async () => {
    const s = source([]);
    await runLeadSearch("c", { source: s, timeoutMs: 5000 });
    expect(vi.mocked(s.search).mock.calls[0]![2]).toBeInstanceOf(AbortSignal);
  });
});

describe("runDailySearch", () => {
  it("desligada: nao consulta campanhas", async () => {
    delete process.env.LEAD_SEARCH_ENABLED;
    expect(await runDailySearch()).toEqual([]);
    expect(p.campaign.findMany).not.toHaveBeenCalled();
  });
  it("pula campanha que ja teve execucao agendada hoje (tick roda a cada minuto)", async () => {
    p.campaign.findMany.mockResolvedValue([{ id: "c" }]);
    p.searchRun.count.mockResolvedValue(1);
    expect(await runDailySearch()).toEqual([]);
    expect(p.searchRun.create).not.toHaveBeenCalled();
  });
  it("limita campanhas por tick", async () => {
    process.env.LEAD_SEARCH_MAX_CAMPAIGNS_PER_TICK = "2";
    p.campaign.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }, { id: "c" }]);
    const r = await runDailySearch({ source: source([]) });
    delete process.env.LEAD_SEARCH_MAX_CAMPAIGNS_PER_TICK;
    expect(r).toHaveLength(2);
  });
  it("respeita deadline", async () => {
    p.campaign.findMany.mockResolvedValue([{ id: "a" }]);
    let t = 0;
    expect(await runDailySearch({ now: () => (t += 1e6) })).toEqual([]);
  });
  it("sem chave places: agendado pula em silencio", async () => {
    p.campaign.findMany.mockResolvedValue([{ id: "c" }]);
    p.searchRun.count.mockResolvedValue(0);
    expect(await runDailySearch()).toEqual([]);
  });
});
