import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { seed } from "../../../prisma/seed";
import { runLeadSearch } from "./run";
import type { LeadSource } from "./types";

const TAG = "zz-test-spec015-conc";
let campaignId = "";
let icpId = "";

const source: LeadSource = { id: "google_places", search: vi.fn(async () => ({ leads: [], requests: 1 })) };

beforeAll(async () => {
  process.env.LEAD_SEARCH_ENABLED = "true";
  process.env.LEAD_SEARCH_DAILY_MAX_REQUESTS = "1";
  await seed(prisma);
  const user = await prisma.user.findFirstOrThrow({ where: { email: "admin@leadforge.local" } });
  icpId = (await prisma.icpProfile.create({ data: { name: TAG, niche: "x", signals: [], keywords: [], sources: [], desiredData: [] } })).id;
  campaignId = (await prisma.campaign.create({ data: { name: TAG, userId: user.id, icpId } })).id;
});
afterAll(async () => {
  await prisma.searchRun.deleteMany({ where: { campaignId } });
  await prisma.campaign.deleteMany({ where: { id: campaignId } });
  await prisma.icpProfile.deleteMany({ where: { id: icpId } });
  delete process.env.LEAD_SEARCH_DAILY_MAX_REQUESTS;
});

describe("SPEC-015 concorrencia", () => {
  it("6 execucoes simultaneas com orcamento 1: so uma chamada paga", async () => {
    const r = await Promise.allSettled(Array.from({ length: 6 }, () => runLeadSearch(campaignId, { source })));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(source.search).toHaveBeenCalledTimes(1);
    const runs = await prisma.searchRun.findMany({ where: { campaignId } });
    expect(runs.filter((x) => x.status === "done")).toHaveLength(1);
    expect(runs.filter((x) => x.status === "blocked")).toHaveLength(5);
  });
  it("dois agendados simultaneos: so um executa", async () => {
    await prisma.searchRun.deleteMany({ where: { campaignId } });
    process.env.LEAD_SEARCH_DAILY_MAX_REQUESTS = "50";
    vi.mocked(source.search).mockClear();
    await Promise.allSettled([1, 2, 3].map(() => runLeadSearch(campaignId, { source, trigger: "scheduled" })));
    expect(source.search).toHaveBeenCalledTimes(1);
  });
});
