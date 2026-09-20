import { describe, it, expect, vi, beforeEach } from "vitest";

const p = vi.hoisted(() => ({
  campaign: { findUnique: vi.fn(), findMany: vi.fn() },
  searchRun: { findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
  lead: { update: vi.fn(), findFirst: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));
p.$transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(p));
vi.mock("@/lib/prisma", () => ({ prisma: p }));
const processItem = vi.hoisted(() => vi.fn());
vi.mock("@/lib/lead-ingest/handler", () => ({ processItem }));
vi.mock("@/lib/integrations/config", () => ({ findIntegrationConfig: vi.fn(async () => null) }));

import { runLeadSearch, runDailySearch } from "./run";
import type { LeadSource } from "./types";

const raw = (id: string, phone: string | null) => ({ externalId: id, name: id, company: id, phone, email: null, website: null, address: null, rating: 4, ratingCount: 10 });
const source = (leads: ReturnType<typeof raw>[]): LeadSource => ({ id: "google_places", search: vi.fn(async () => ({ leads, requests: 1 })) });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LEAD_SEARCH_ENABLED = "true";
  p.campaign.findUnique.mockResolvedValue({ id: "c", status: "active", icp: { niche: "x", location: null, keywords: [] } });
  p.searchRun.findMany.mockResolvedValue([]);
  p.searchRun.count.mockResolvedValue(0);
  p.searchRun.create.mockResolvedValue({ id: "r1" });
  p.lead.findFirst.mockResolvedValue(null);
  p.lead.update.mockResolvedValue({});
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
  it("respeita orcamento diario", async () => {
    p.searchRun.findMany.mockResolvedValue([{ status: "done", requests: 3 }]);
    await expect(runLeadSearch("c", { source: source([]) })).rejects.toMatchObject({ code: "rate_limited" });
    expect(p.searchRun.create.mock.calls[0]![0].data).toMatchObject({ status: "blocked" });
  });
  it("agendado bloqueado nao grava run", async () => {
    p.searchRun.findMany.mockResolvedValue([{ status: "done", requests: 3 }]);
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
  it("falha da fonte registra run failed", async () => {
    const s: LeadSource = { id: "google_places", search: vi.fn(async () => { throw new Error("x"); }) };
    await expect(runLeadSearch("c", { source: s })).rejects.toThrow();
    expect(p.searchRun.update.mock.calls[0]![0].data.status).toBe("failed");
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
