import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { seed, SEED_IDS } from "../../../prisma/seed";
import { createTestOrg, purgeTestOrg } from "@/lib/test-utils/org-fixture";
import { runLeadSearch, startLeadSearch } from "./run";
import { AxiosError, type AxiosAdapter } from "axios";
import { createPlacesClient, PlacesSource } from "./places";
import type { LeadSource } from "./types";

/** SPEC-058a com banco real: lock "1 busca por campanha por vez", STALE, tetos manual/org. */
const TAG = "zz-test-spec058-conc";
let userId = "";
let icpId = "";
let campA = "";
let campB = "";

const mkSource = (delayMs = 0): LeadSource => ({
  id: "google_places",
  search: vi.fn(async () => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return { leads: [], requests: 1 };
  }),
});

const mkCamp = async (n: string) => (await prisma.campaign.create({ data: { name: `${TAG}-${n}`, userId, icpId, orgId: SEED_IDS.org } })).id;
const clean = () => prisma.searchRun.deleteMany({ where: { campaignId: { in: [campA, campB] } } });

beforeAll(async () => {
  process.env.LEAD_SEARCH_ENABLED = "true";
  await seed(prisma);
  userId = (await prisma.user.findFirstOrThrow({ where: { email: "admin@leadforge.local" } })).id;
  icpId = (await prisma.icpProfile.create({ data: { orgId: SEED_IDS.org, name: TAG, niche: "x", signals: [], keywords: [], sources: [], desiredData: [] } })).id;
  campA = await mkCamp("a");
  campB = await mkCamp("b");
});
beforeEach(async () => {
  await clean();
  delete process.env.LEAD_SEARCH_MANUAL_DAILY_MAX_REQUESTS;
  // Isola o teto da org de dados de outros testes do mesmo banco: so conta runs de hoje da org; os testes usam teto relativo.
  process.env.LEAD_SEARCH_ORG_DAILY_MAX_REQUESTS = "200";
});
afterAll(async () => {
  await clean();
  await prisma.campaign.deleteMany({ where: { id: { in: [campA, campB] } } });
  await prisma.icpProfile.deleteMany({ where: { id: icpId } });
  delete process.env.LEAD_SEARCH_ORG_DAILY_MAX_REQUESTS;
});

describe("SPEC-058 concorrencia (banco real)", () => {
  it("2 disparos simultaneos (Promise.all): 1 run e 1 chamada Places; o 2o recebe o runId em andamento", async () => {
    const s = mkSource(200);
    const [a, b] = await Promise.all([startLeadSearch(campA, { source: s }), startLeadSearch(campA, { source: s })]);
    expect(s.search).toHaveBeenCalledTimes(1);
    const done = [a, b].filter((x) => "runId" in x);
    const inProg = [a, b].filter((x) => "inProgress" in x);
    expect(done).toHaveLength(1);
    expect(inProg).toHaveLength(1);
    expect((inProg[0] as { inProgress: string }).inProgress).toBe((done[0] as { runId: string }).runId);
    expect(await prisma.searchRun.count({ where: { campaignId: campA } })).toBe(1);
  });

  it("manual durante diaria running: recusado, sem chamada paga nem novo run", async () => {
    await prisma.searchRun.create({ data: { campaignId: campA, source: "google_places", trigger: "scheduled", status: "running" } });
    const s = mkSource();
    await expect(runLeadSearch(campA, { source: s })).rejects.toMatchObject({ code: "conflict", userMessage: expect.stringContaining("em andamento") });
    expect(s.search).not.toHaveBeenCalled();
    expect(await prisma.searchRun.count({ where: { campaignId: campA } })).toBe(1);
  });

  it("diaria durante manual running: pula sem consumir", async () => {
    await prisma.searchRun.create({ data: { campaignId: campA, source: "google_places", trigger: "manual", status: "running" } });
    const s = mkSource();
    await expect(runLeadSearch(campA, { source: s, trigger: "scheduled" })).rejects.toMatchObject({ code: "conflict" });
    expect(s.search).not.toHaveBeenCalled();
    expect(await prisma.searchRun.count({ where: { campaignId: campA } })).toBe(1);
  });

  it("run running > 10 min vira failed (cobra 1) e a campanha volta a poder buscar", async () => {
    const stale = await prisma.searchRun.create({ data: { campaignId: campA, source: "google_places", trigger: "manual", status: "running", startedAt: new Date(Date.now() - 11 * 60_000) } });
    const s = mkSource();
    const o = await runLeadSearch(campA, { source: s });
    expect(s.search).toHaveBeenCalledTimes(1);
    expect(o.runId).not.toBe(stale.id);
    const r = await prisma.searchRun.findUniqueOrThrow({ where: { id: stale.id } });
    expect(r).toMatchObject({ status: "failed", requests: 1, error: "Execução interrompida." });
    expect(r.finishedAt).not.toBeNull();
  });

  it("teto manual (2/dia): 3o bloqueia (blocked nao consome) e a diaria NAO e afetada", async () => {
    const s = mkSource();
    await runLeadSearch(campA, { source: s });
    await runLeadSearch(campA, { source: s });
    await expect(runLeadSearch(campA, { source: s })).rejects.toMatchObject({ code: "rate_limited", userMessage: expect.stringContaining("manuais") });
    expect(s.search).toHaveBeenCalledTimes(2);
    const blocked = await prisma.searchRun.findMany({ where: { campaignId: campA, status: "blocked" } });
    expect(blocked).toHaveLength(1);
    expect(blocked[0]!.requests).toBe(0);
    await expect(runLeadSearch(campA, { source: s, trigger: "scheduled" })).resolves.toMatchObject({ requests: 1 });
    expect(s.search).toHaveBeenCalledTimes(3);
  });

  it("teto manual configuravel por env", async () => {
    process.env.LEAD_SEARCH_MANUAL_DAILY_MAX_REQUESTS = "1";
    const s = mkSource();
    await runLeadSearch(campA, { source: s });
    await expect(runLeadSearch(campA, { source: s })).rejects.toMatchObject({ code: "rate_limited" });
    expect(s.search).toHaveBeenCalledTimes(1);
  });

  it("teto da org soma campanhas e origens: bloqueia manual em outra campanha da mesma org (e nao afeta outra org)", async () => {
    const org = await createTestOrg("058-org");
    try {
      const icp = await prisma.icpProfile.create({ data: { orgId: org.orgId, name: TAG, niche: "x", signals: [], keywords: [], sources: [], desiredData: [] } });
      const c1 = (await prisma.campaign.create({ data: { name: `${TAG}-o1`, userId: org.userId, icpId: icp.id, orgId: org.orgId } })).id;
      const c2 = (await prisma.campaign.create({ data: { name: `${TAG}-o2`, userId: org.userId, icpId: icp.id, orgId: org.orgId } })).id;
      process.env.LEAD_SEARCH_ORG_DAILY_MAX_REQUESTS = "1";
      const s = mkSource();
      await runLeadSearch(c1, { source: s, trigger: "scheduled" });
      await expect(runLeadSearch(c2, { source: s })).rejects.toMatchObject({ code: "rate_limited", userMessage: expect.stringContaining("organização") });
      expect(s.search).toHaveBeenCalledTimes(1);
      // outra org (seed) com o mesmo teto: nao e afetada pelo consumo desta org
      process.env.LEAD_SEARCH_ORG_DAILY_MAX_REQUESTS = "200";
      await expect(runLeadSearch(campB, { source: s })).resolves.toMatchObject({ requests: 1 });
    } finally {
      await purgeTestOrg(org);
    }
  });

  it("2 manuais simultaneos em campanhas DIFERENTES da mesma org perto do teto: so 1 passa (lock por org)", async () => {
    const org = await createTestOrg("058-orgrace");
    try {
      const icp = await prisma.icpProfile.create({ data: { orgId: org.orgId, name: TAG, niche: "x", signals: [], keywords: [], sources: [], desiredData: [] } });
      const c1 = (await prisma.campaign.create({ data: { name: `${TAG}-r1`, userId: org.userId, icpId: icp.id, orgId: org.orgId } })).id;
      const c2 = (await prisma.campaign.create({ data: { name: `${TAG}-r2`, userId: org.userId, icpId: icp.id, orgId: org.orgId } })).id;
      process.env.LEAD_SEARCH_ORG_DAILY_MAX_REQUESTS = "1";
      const s = mkSource(150);
      const r = await Promise.allSettled([runLeadSearch(c1, { source: s }), runLeadSearch(c2, { source: s })]);
      expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      const rej = r.filter((x) => x.status === "rejected") as PromiseRejectedResult[];
      expect(rej).toHaveLength(1);
      expect(rej[0]!.reason).toMatchObject({ code: "rate_limited", userMessage: expect.stringContaining("organização") });
      expect(s.search).toHaveBeenCalledTimes(1);
    } finally {
      await purgeTestOrg(org);
    }
  });

  describe("falha da Places vira run failed em PT-BR sem vazar a chave", () => {
    const KEY = "KEY-SECRET-058";
    const fromAdapter = (step: { status: number } | { code: string }): LeadSource => {
      const adapter: AxiosAdapter = async (config) => {
        if ("code" in step) throw new AxiosError(`boom ${KEY}`, step.code, config);
        const res = { data: {}, status: step.status, statusText: "", headers: { "retry-after": "0" }, config, request: {} };
        throw new AxiosError(`fail ${KEY}`, "ERR_BAD_RESPONSE", config, {}, res);
      };
      return new PlacesSource(createPlacesClient(KEY, adapter));
    };
    for (const [nome, step] of [["429", { status: 429 }], ["503", { status: 503 }], ["timeout", { code: "ECONNABORTED" }]] as const) {
      it(nome, async () => {
        await expect(runLeadSearch(campA, { source: fromAdapter(step) })).rejects.toBeDefined();
        const run = await prisma.searchRun.findFirstOrThrow({ where: { campaignId: campA } });
        expect(run.status).toBe("failed");
        expect(run.requests).toBeGreaterThanOrEqual(1);
        expect(run.finishedAt).not.toBeNull();
        expect(run.error).toBeTruthy();
        expect(run.error).not.toContain(KEY);
        expect(run.error).not.toMatch(/axios|status code|ECONNABORTED/i);
        expect(run.error).toMatch(/[áâãçéêíóôõú]|busca|Tente|indispon|limite|Places/i);
      });
    }
  });
});
