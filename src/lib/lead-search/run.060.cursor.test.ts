import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { seed, SEED_IDS } from "../../../prisma/seed";
import { runLeadSearch } from "./run";
import type { LeadSource, RawLead, SearchOptions } from "./types";

const TAG = "zz-test-spec060";
let campaignId = "";
let icpId = "";
const lead = (id: string, phone: string): RawLead => ({ externalId: id, name: id, company: id, phone, email: null, website: null, address: null, rating: 4, ratingCount: 5 });
const mk = (leads: RawLead[], cursor: { variant: number; pageToken: string | null; query: string } | null, requests = 1) => {
  const search = vi.fn(async (...args: [unknown, number, (AbortSignal | undefined)?, SearchOptions?]) => { void args; return { leads, requests, cursor }; });
  return { id: "google_places", search } satisfies LeadSource;
};

beforeAll(async () => {
  process.env.LEAD_SEARCH_ENABLED = "true";
  process.env.LEAD_SEARCH_MANUAL_DAILY_MAX_REQUESTS = "20";
  process.env.LEAD_SEARCH_ORG_DAILY_MAX_REQUESTS = "200";
  await seed(prisma);
  const user = await prisma.user.findFirstOrThrow({ where: { email: "admin@leadforge.local" } });
  icpId = (await prisma.icpProfile.create({ data: { orgId: SEED_IDS.org, name: TAG, niche: "x", signals: [], keywords: [], sources: [], desiredData: [] } })).id;
  campaignId = (await prisma.campaign.create({ data: { name: TAG, userId: user.id, icpId, orgId: SEED_IDS.org } })).id;
});
afterAll(async () => {
  await prisma.lead.deleteMany({ where: { campaignId } });
  await prisma.searchRun.deleteMany({ where: { campaignId } });
  await prisma.campaign.deleteMany({ where: { id: campaignId } });
  await prisma.icpProfile.deleteMany({ where: { id: icpId } });
  delete process.env.LEAD_SEARCH_MANUAL_DAILY_MAX_REQUESTS;
  delete process.env.LEAD_SEARCH_ORG_DAILY_MAX_REQUESTS;
});

describe("SPEC-060 cursor persistido", () => {
  it("AC-6: run done grava cursor; busca seguinte o recebe; dedupe nao recria leads", async () => {
    const s1 = mk([lead("p1", "+5581911110001"), lead("p2", "+5581911110002")], { variant: 0, pageToken: "TK1", query: "x" });
    const o1 = await runLeadSearch(campaignId, { source: s1 });
    expect(o1.created).toBe(2);
    expect(s1.search.mock.calls[0]![3]).toMatchObject({ cursor: null });
    const saved = await prisma.searchRun.findUniqueOrThrow({ where: { id: o1.runId } });
    expect(saved).toMatchObject({ pageToken: "TK1", searchQuery: "x", variant: 0 });

    const s2 = mk([lead("p2", "+5581911110002"), lead("p3", "+5581911110003")], { variant: 0, pageToken: null, query: "x" });
    const o2 = await runLeadSearch(campaignId, { source: s2 });
    expect(s2.search.mock.calls[0]![3]).toMatchObject({ cursor: { variant: 0, pageToken: "TK1", query: "x" } });
    expect(o2).toMatchObject({ created: 1, duplicate: 1 });
    expect(await prisma.lead.count({ where: { campaignId } })).toBe(3);
  });
  it("AC-6: run failed nao altera o cursor", async () => {
    const bad: LeadSource = { id: "google_places", search: vi.fn(async () => { throw new Error("boom KEY-SECRET"); }) };
    await expect(runLeadSearch(campaignId, { source: bad })).rejects.toThrow();
    const s = mk([], { variant: 1, pageToken: null, query: "x" });
    await runLeadSearch(campaignId, { source: s });
    expect(s.search.mock.calls[0]![3]).toMatchObject({ cursor: { variant: 0, pageToken: null, query: "x" } });
    const failed = await prisma.searchRun.findFirstOrThrow({ where: { campaignId, status: "failed" } });
    expect(failed.pageToken).toBeNull();
    expect(failed.error ?? "").not.toContain("KEY-SECRET");
  });
  it("400 na 1a chamada + 5xx na 2a: requests=2 no run failed e cursor inalterado", async () => {
    await prisma.searchRun.deleteMany({ where: { campaignId } });
    const ok = mk([], { variant: 0, pageToken: "TK9", query: "x" });
    await runLeadSearch(campaignId, { source: ok });
    // Simula PlacesSource: 2 chamadas pagas (400 do token, depois 5xx) e lança; o contador mutável fica visível ao run.
    const bad: LeadSource = { id: "google_places", search: vi.fn(async (_i, _l, _s, o?: SearchOptions) => { if (o?.progress) o.progress.requests = 2; throw new Error("5xx"); }) };
    await expect(runLeadSearch(campaignId, { source: bad })).rejects.toThrow();
    const failed = await prisma.searchRun.findFirstOrThrow({ where: { campaignId, status: "failed" } });
    expect(failed.requests).toBe(2);
    expect(failed.pageToken).toBeNull();
    const s = mk([], null);
    await runLeadSearch(campaignId, { source: s });
    expect(s.search.mock.calls[0]![3]).toMatchObject({ cursor: { variant: 0, pageToken: "TK9", query: "x" } });
  });
  it("AC-5: maxRequests entregue respeita o orcamento restante (<=2) e orcamento esgotado nao chama a fonte", async () => {
    await prisma.searchRun.deleteMany({ where: { campaignId } });
    process.env.LEAD_SEARCH_MANUAL_DAILY_MAX_REQUESTS = "2";
    const s = mk([], null);
    await runLeadSearch(campaignId, { source: s });
    expect(s.search.mock.calls[0]![3]).toMatchObject({ maxRequests: 2 });
    const s2 = mk([], null);
    await runLeadSearch(campaignId, { source: s2 });
    expect(s2.search.mock.calls[0]![3]).toMatchObject({ maxRequests: 1 });
    const s3 = mk([], null);
    await expect(runLeadSearch(campaignId, { source: s3 })).rejects.toMatchObject({ code: "rate_limited" });
    expect(s3.search).not.toHaveBeenCalled();
    process.env.LEAD_SEARCH_MANUAL_DAILY_MAX_REQUESTS = "20";
  });
});
