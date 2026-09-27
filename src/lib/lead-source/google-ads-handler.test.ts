import "dotenv/config";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { seed } from "../../../prisma/seed";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import * as route from "@/app/api/integrations/leads/google-ads/route";
import { _resetGoogleAdsRateLimit } from "./google-ads-handler";

const TAG = "spec041-google-ads";
let orgA: TestOrg;
let orgB: TestOrg;
let campaignA = "";
let campaignB = "";
let n = 0;

async function makeCampaign(org: TestOrg, statusValue: "active" | "archived" | "paused" = "active") {
  const k = ++n;
  const icp = await prisma.icpProfile.create({
    data: { orgId: org.orgId, name: `${TAG}-icp-${k}`, niche: "n", signals: [], keywords: [], sources: [], desiredData: [] },
  });
  const c = await prisma.campaign.create({
    data: { orgId: org.orgId, name: `zz-${TAG}-c${k}`, icpId: icp.id, userId: org.userId, status: statusValue },
  });
  return c.id;
}

const post = (body: unknown, opts: { raw?: BodyInit; contentLength?: number } = {}) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.contentLength !== undefined) headers["content-length"] = String(opts.contentLength);
  return route.POST(new Request("http://localhost:3000/api/integrations/leads/google-ads", { method: "POST", headers, body: opts.raw ?? JSON.stringify(body) }));
};

beforeAll(async () => {
  await seed(prisma);
  orgA = await createTestOrg(TAG + "-a");
  orgB = await createTestOrg(TAG + "-b");
  campaignA = await makeCampaign(orgA);
  campaignB = await makeCampaign(orgB);
}, 30000);
afterAll(async () => {
  await prisma.webhookEvent.deleteMany({ where: { source: "google_ads_leads" } });
  await purgeTestOrg(orgA);
  await purgeTestOrg(orgB);
  await prisma.$disconnect();
});
beforeEach(() => {
  _resetGoogleAdsRateLimit();
  process.env.INTEGRATION_LEADS_GOOGLE_ADS_ENABLED = "true";
});
afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.INTEGRATION_LEADS_GOOGLE_ADS_ENABLED;
});

const gKeyA = () => `zz-gkey-a-${++n}`;
const userColumnData = (over: Record<string, string> = {}) => {
  const base: Record<string, string> = { FULL_NAME: "Ana Souza", EMAIL: `ana${n}@${TAG}.com`, PHONE_NUMBER: `11 9${String(n).padStart(8, "0")}`, ...over };
  return Object.entries(base).map(([column_id, string_value]) => ({ column_id, column_name: column_id, string_value }));
};
const payload = (googleKey: string, leadId: string, over: Record<string, string> = {}) => ({
  google_key: googleKey,
  lead_id: leadId,
  campaign_id: "999",
  user_column_data: userColumnData(over),
});

describe("config e autenticação", () => {
  it("503 sem a flag ligada", async () => {
    delete process.env.INTEGRATION_LEADS_GOOGLE_ADS_ENABLED;
    expect((await post(payload("qualquer", "1"))).status).toBe(503);
  });
  it("401 quando google_key ausente, malformado ou não corresponde a nenhum vínculo — NADA é criado", async () => {
    const before = await prisma.lead.count({ where: { campaignId: campaignA } });
    const a = await post({ lead_id: "1", user_column_data: [] });
    const b = await post(payload("chave espaço inválida!!", "1"));
    const c = await post(payload("zz-chave-nunca-cadastrada-em-lugar-nenhum", "1"));
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(c.status).toBe(401);
    expect(await prisma.lead.count({ where: { campaignId: campaignA } })).toBe(before);
  });
  it("405 nos demais métodos", async () => {
    for (const m of ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "DELETE"] as const) {
      expect((await (route[m] as () => Promise<Response>)()).status, m).toBe(405);
    }
  });
  it("413 corpo grande demais", async () => {
    const r = await post(undefined, { raw: "x".repeat(2_000_000), contentLength: 2_000_000 });
    expect(r.status).toBe(413);
  });
  it("400 JSON inválido", async () => {
    const r = await post(undefined, { raw: "{not json" });
    expect(r.status).toBe(400);
  });
  it("429 após excesso de tentativas inválidas (google_key desconhecida)", async () => {
    let last: Response | null = null;
    for (let i = 0; i < 25; i++) last = await post(payload(`zz-forjada-${i}`, "1"));
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });
});

describe("resolução de org/campanha exclusivamente via LeadSourceBinding (D-041-3)", () => {
  it("cria o lead na Campaign vinculada, mapeando os campos fixos e jogando o resto pro rawData", async () => {
    const key = gKeyA();
    await prisma.leadSourceBinding.create({ data: { orgId: orgA.orgId, campaignId: campaignA, provider: "google_ads", externalAccountId: key } });
    const leadId = `lead-${++n}`;
    const r = await post(payload(key, leadId, { JOB_TITLE: "CTO" }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.status).toBe("created");
    const lead = await prisma.lead.findFirst({ where: { campaignId: campaignA, source: "google_ads_leads" }, orderBy: { id: "desc" } });
    expect(lead?.name).toBe("Ana Souza");
    expect(lead?.phone).toBe(`+55119${String(n).padStart(8, "0")}`);
    expect((lead?.rawData as Record<string, unknown>)?.JOB_TITLE).toBe("CTO");
    expect((lead?.rawData as Record<string, unknown>)?.externalLeadId).toBe(leadId);
  });

  it("reenvio do mesmo lead_id é idempotente (não duplica)", async () => {
    const key = gKeyA();
    await prisma.leadSourceBinding.create({ data: { orgId: orgA.orgId, campaignId: campaignA, provider: "google_ads", externalAccountId: key } });
    const leadId = `lead-dup-${++n}`;
    const first = await post(payload(key, leadId));
    const before = await prisma.lead.count({ where: { campaignId: campaignA } });
    const second = await post(payload(key, leadId));
    expect((await first.json()).status).toBe("created");
    expect((await second.json()).status).toBe("created"); // eco do resultado já processado
    expect(await prisma.lead.count({ where: { campaignId: campaignA } })).toBe(before);
  });

  it("CRÍTICO: um payload com google_key cadastrado pra Org A NUNCA cria lead na Campaign de Org B", async () => {
    const key = gKeyA();
    await prisma.leadSourceBinding.create({ data: { orgId: orgA.orgId, campaignId: campaignA, provider: "google_ads", externalAccountId: key } });
    const leadId = `lead-cross-${++n}`;
    const r = await post(payload(key, leadId));
    expect(r.status).toBe(200);
    expect(await prisma.lead.count({ where: { campaignId: campaignB } })).toBe(0);
    const lead = await prisma.lead.findFirst({ where: { campaignId: campaignA }, orderBy: { id: "desc" } });
    expect(lead).not.toBeNull();
  });

  it("respeita supressão da org (não cria lead suprimido)", async () => {
    const key = gKeyA();
    await prisma.leadSourceBinding.create({ data: { orgId: orgA.orgId, campaignId: campaignA, provider: "google_ads", externalAccountId: key } });
    const email = `zz-suprimido-${++n}@${TAG}.com`;
    await prisma.suppression.create({ data: { orgId: orgA.orgId, kind: "email", value: email, reason: "manual" } });
    const r = await post(payload(key, `lead-supp-${n}`, { EMAIL: email }));
    const body = await r.json();
    expect(body.status).toBe("suppressed");
    expect(await prisma.lead.count({ where: { campaignId: campaignA, email } })).toBe(0);
  });

  it("campanha arquivada: não cria lead", async () => {
    const archivedCampaignId = await makeCampaign(orgA, "archived");
    const key = gKeyA();
    await prisma.leadSourceBinding.create({ data: { orgId: orgA.orgId, campaignId: archivedCampaignId, provider: "google_ads", externalAccountId: key } });
    const r = await post(payload(key, `lead-arch-${++n}`));
    const body = await r.json();
    expect(body.status).toBe("campaign_archived");
    expect(await prisma.lead.count({ where: { campaignId: archivedCampaignId } })).toBe(0);
  });
});
