import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));

const places = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/lib/lead-search/places", async (orig) => ({ ...(await orig<typeof import("@/lib/lead-search/places")>()), createPlacesClient: () => ({ post: places.post }) }));
vi.mock("@/lib/integrations/config", async (orig) => ({
  ...(await orig<typeof import("@/lib/integrations/config")>()),
  findIntegrationConfig: vi.fn(async () => ({ reveal: () => "chave-falsa" })),
  integrationOrigin: vi.fn(async () => "db"),
}));

import { prisma } from "@/lib/prisma";
import { signInAs, signOut } from "@/lib/auth/test-helpers";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { getLeadSearchPanel } from "@/lib/queries/lead-search";
import { getSearchRunStatus, searchLeads } from "./lead-search";

/** SPEC-058a: papel owner, escopo de org (cross-tenant), polling por runId e painel. Places mockado: nenhuma chamada real. */
const TAG = "zz-spec058-act";
let orgA: TestOrg;
let orgB: TestOrg;
let memberId = "";
let campA = "";
let campB = "";

const mkCamp = async (org: TestOrg, n: string) => {
  const icp = await prisma.icpProfile.create({ data: { orgId: org.orgId, name: `${TAG}-${n}`, niche: "x", signals: [], keywords: [], sources: [], desiredData: [] } });
  return (await prisma.campaign.create({ data: { name: `${TAG}-${n}`, orgId: org.orgId, icpId: icp.id, userId: org.userId } })).id;
};

beforeAll(async () => {
  orgA = await createTestOrg("058a");
  orgB = await createTestOrg("058b");
  memberId = (await prisma.user.create({ data: { name: "zz member", email: `zz-058-member-${orgA.userId.slice(0, 8)}@test.local`, role: "provider" } })).id;
  await prisma.membership.create({ data: { userId: memberId, orgId: orgA.orgId, orgRole: "member" } });
  campA = await mkCamp(orgA, "a");
  campB = await mkCamp(orgB, "b");
});
beforeEach(async () => {
  process.env.LEAD_SEARCH_ENABLED = "true";
  places.post.mockReset();
  places.post.mockResolvedValue({ data: { places: [] } });
  await prisma.searchRun.deleteMany({ where: { campaignId: { in: [campA, campB] } } });
});
afterAll(async () => {
  signOut();
  await purgeTestOrg(orgA);
  await purgeTestOrg(orgB);
  await prisma.membership.deleteMany({ where: { userId: memberId } });
  await prisma.user.deleteMany({ where: { id: memberId } });
});

const asOwnerA = () => signInAs(orgA.userId, { orgId: orgA.orgId, platformRole: "provider" });
const asMemberA = () => signInAs(memberId, { orgId: orgA.orgId, platformRole: "provider" });

describe("searchLeads (SPEC-058a)", () => {
  it("membro nao-owner: erro PT-BR, nenhuma chamada Places e nenhum SearchRun", async () => {
    await asMemberA();
    const r = await searchLeads(campA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors._form![0]).toMatch(/propriet/i);
    expect(places.post).not.toHaveBeenCalled();
    expect(await prisma.searchRun.count({ where: { campaignId: campA } })).toBe(0);
  });

  it("owner passa: 1 chamada Places, run done com runId", async () => {
    await asOwnerA();
    const r = await searchLeads(campA);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.status).toBe("done");
      expect(await prisma.searchRun.findUniqueOrThrow({ where: { id: r.data.runId } })).toMatchObject({ status: "done", trigger: "manual", requests: 1 });
    }
    expect(places.post).toHaveBeenCalledTimes(1);
  });

  it("campanha de outra org: 'Campanha nao encontrada', sem chamada paga nem run", async () => {
    await asOwnerA();
    const r = await searchLeads(campB);
    expect(r).toEqual({ ok: false, errors: { _form: ["Campanha não encontrada."] } });
    expect(places.post).not.toHaveBeenCalled();
    expect(await prisma.searchRun.count({ where: { campaignId: campB } })).toBe(0);
  });

  it("desligada: mensagem sem env var e run blocked", async () => {
    delete process.env.LEAD_SEARCH_ENABLED;
    await asOwnerA();
    const r = await searchLeads(campA);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors._form![0]).toMatch(/fale com o suporte/);
      expect(r.errors._form![0]).not.toMatch(/LEAD_SEARCH/);
    }
    expect(places.post).not.toHaveBeenCalled();
    expect(await prisma.searchRun.count({ where: { campaignId: campA, status: "blocked" } })).toBe(1);
  });
});

describe("getSearchRunStatus / getLeadSearchPanel (SPEC-058a)", () => {
  it("polling: so enxerga runs de campanhas da propria org", async () => {
    const run = await prisma.searchRun.create({ data: { campaignId: campA, source: "google_places", trigger: "manual", status: "running" } });
    await asOwnerA();
    const ok = await getSearchRunStatus(run.id);
    expect(ok).toMatchObject({ ok: true, data: { id: run.id, status: "running" } });
    await signInAs(orgB.userId, { orgId: orgB.orgId, platformRole: "provider" });
    expect(await getSearchRunStatus(run.id)).toEqual({ ok: false, errors: { _form: ["Busca não encontrada."] } });
    expect((await getSearchRunStatus("nao-e-uuid")).ok).toBe(false);
  });

  it("run running preso (>10 min) aparece como failed no polling", async () => {
    const run = await prisma.searchRun.create({ data: { campaignId: campA, source: "google_places", trigger: "manual", status: "running", startedAt: new Date(Date.now() - 11 * 60_000) } });
    await asOwnerA();
    expect(await getSearchRunStatus(run.id)).toMatchObject({ ok: true, data: { status: "failed", error: "Execução interrompida." } });
  });

  it("painel: role, restantes, estimativa e activeRun pela mesma contagem do reserve", async () => {
    await asOwnerA();
    let p = await getLeadSearchPanel(campA);
    expect(p).toMatchObject({ canManage: true, role: "owner", usedToday: 0, remainingManual: 2, remainingOrg: 10, estimatedPaidCallsLeft: 2, activeRun: null, hasNextPage: false });
    const run = await prisma.searchRun.create({ data: { campaignId: campA, source: "google_places", trigger: "manual", status: "running" } });
    p = await getLeadSearchPanel(campA);
    // running conta 1 (mesma regra do reserve), mesmo com requests = 0
    expect(p).toMatchObject({ usedToday: 1, remainingManual: 1, remainingOrg: 9, estimatedPaidCallsLeft: 1 });
    if (p.canManage) expect(p.activeRun?.id).toBe(run.id);
    await asMemberA();
    p = await getLeadSearchPanel(campA);
    expect(p).toMatchObject({ canManage: true, role: "member" });
  });

  it("painel de campanha de outra org nao vaza runs", async () => {
    await prisma.searchRun.create({ data: { campaignId: campB, source: "google_places", trigger: "manual", status: "done", requests: 1 } });
    await asOwnerA();
    const p = await getLeadSearchPanel(campB);
    if (p.canManage) {
      expect(p.runs).toHaveLength(0);
      expect(p.usedToday).toBe(0);
    }
  });
});
