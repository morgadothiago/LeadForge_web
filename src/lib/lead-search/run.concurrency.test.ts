import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { seed, SEED_IDS } from "../../../prisma/seed";
import { runLeadSearch } from "./run";
import type { LeadSource } from "./types";

const TAG = "zz-test-spec015-conc";
let campaignId = "";
let icpId = "";

// Pequeno atraso: mantém o run "running" enquanto as concorrentes passam pelo lock (SPEC-058: 1 busca por campanha por vez).
const source: LeadSource = { id: "google_places", search: vi.fn(async () => { await new Promise((r) => setTimeout(r, 150)); return { leads: [], requests: 1 }; }) };

beforeAll(async () => {
  process.env.LEAD_SEARCH_ENABLED = "true";
  process.env.LEAD_SEARCH_DAILY_MAX_REQUESTS = "1";
  await seed(prisma);
  const user = await prisma.user.findFirstOrThrow({ where: { email: "admin@leadforge.local" } });
  icpId = (await prisma.icpProfile.create({ data: { orgId: SEED_IDS.org, name: TAG, niche: "x", signals: [], keywords: [], sources: [], desiredData: [] } })).id;
  campaignId = (await prisma.campaign.create({ data: { name: TAG, userId: user.id, icpId, orgId: SEED_IDS.org } })).id;
});
afterAll(async () => {
  await prisma.searchRun.deleteMany({ where: { campaignId } });
  await prisma.campaign.deleteMany({ where: { id: campaignId } });
  await prisma.icpProfile.deleteMany({ where: { id: icpId } });
  delete process.env.LEAD_SEARCH_DAILY_MAX_REQUESTS;
});

describe("SPEC-015 concorrencia", () => {
  it("6 execucoes manuais simultaneas: so uma chamada paga (as demais recebem 'em andamento', nao criam run)", async () => {
    const r = await Promise.allSettled(Array.from({ length: 6 }, () => runLeadSearch(campaignId, { source })));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(source.search).toHaveBeenCalledTimes(1);
    const runs = await prisma.searchRun.findMany({ where: { campaignId } });
    expect(runs.filter((x) => x.status === "done")).toHaveLength(1);
    expect(runs).toHaveLength(1);
  });
  it("dois agendados simultaneos: so um executa", async () => {
    await prisma.searchRun.deleteMany({ where: { campaignId } });
    process.env.LEAD_SEARCH_DAILY_MAX_REQUESTS = "50";
    vi.mocked(source.search).mockClear();
    await Promise.allSettled([1, 2, 3].map(() => runLeadSearch(campaignId, { source, trigger: "scheduled" })));
    expect(source.search).toHaveBeenCalledTimes(1);
  });
});
