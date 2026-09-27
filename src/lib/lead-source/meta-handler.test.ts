import "dotenv/config";
import { randomBytes, createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto/secret-box";
import { seed } from "../../../prisma/seed";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import * as route from "@/app/api/integrations/leads/meta/route";
import { _resetMetaRateLimit } from "./meta-handler";
import { _setGraphApiFetch } from "./graph-api";
import { metaPageTokenName } from "./secrets";

const TAG = "spec041-meta";
const APP_SECRET = "meta-app-secret-de-teste-0123456789";
const VERIFY_TOKEN = "meta-verify-token-de-teste-0123456789";
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

async function setPageToken(orgId: string, pageId: string, token: string) {
  await prisma.integrationSecret.create({
    data: { orgId, integration: "meta_leads", name: metaPageTokenName(pageId), encryptedValue: encrypt(token), hint: token.slice(-4) },
  });
}

const sign = (body: string) => `sha256=${createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex")}`;

const leadgenPayload = (pageId: string, leadgenId: string) =>
  JSON.stringify({
    object: "page",
    entry: [{ id: pageId, time: Date.now(), changes: [{ field: "leadgen", value: { leadgen_id: leadgenId, page_id: pageId, form_id: "f1", created_time: Date.now() } }] }],
  });

const post = (rawBody: string, opts: { signature?: string | null } = {}) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const sig = opts.signature === undefined ? sign(rawBody) : opts.signature;
  if (sig !== null) headers["x-hub-signature-256"] = sig;
  return route.POST(new Request("http://localhost:3000/api/integrations/leads/meta", { method: "POST", headers, body: rawBody }));
};
const get = (qs: string) => route.GET(new Request(`http://localhost:3000/api/integrations/leads/meta?${qs}`));

const fakeGraphFetch = (fieldsByLeadgenId: Record<string, { name: string; values: string[] }[]>): typeof fetch =>
  (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const leadgenId = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    const fields = fieldsByLeadgenId[leadgenId];
    if (!fields) return new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404 });
    return new Response(JSON.stringify({ id: leadgenId, field_data: fields }), { status: 200 });
  }) as typeof fetch;

beforeAll(async () => {
  await seed(prisma);
  orgA = await createTestOrg(TAG + "-a");
  orgB = await createTestOrg(TAG + "-b");
  campaignA = await makeCampaign(orgA);
  campaignB = await makeCampaign(orgB);
}, 30000);
afterAll(async () => {
  await prisma.webhookEvent.deleteMany({ where: { source: "meta_leads" } });
  await purgeTestOrg(orgA);
  await purgeTestOrg(orgB);
  await prisma.$disconnect();
});
beforeEach(() => {
  _resetMetaRateLimit();
  process.env.INTEGRATION_LEADS_META_ENABLED = "true";
  process.env.META_APP_SECRET = APP_SECRET;
  process.env.META_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN;
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
});
afterEach(async () => {
  vi.restoreAllMocks();
  _setGraphApiFetch(null);
  delete process.env.INTEGRATION_LEADS_META_ENABLED;
  delete process.env.META_APP_SECRET;
  delete process.env.META_WEBHOOK_VERIFY_TOKEN;
  delete process.env.ENCRYPTION_KEY;
});

describe("GET (handshake de inscrição)", () => {
  it("responde o challenge quando o verify_token confere", async () => {
    const r = await get("hub.mode=subscribe&hub.verify_token=" + VERIFY_TOKEN + "&hub.challenge=abc123");
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("abc123");
  });
  it("401 com verify_token errado; 503 sem configuração", async () => {
    expect((await get("hub.mode=subscribe&hub.verify_token=errado&hub.challenge=abc")).status).toBe(401);
    delete process.env.META_WEBHOOK_VERIFY_TOKEN;
    expect((await get("hub.mode=subscribe&hub.verify_token=" + VERIFY_TOKEN + "&hub.challenge=abc")).status).toBe(503);
  });
});

describe("POST leadgen: assinatura verificada ANTES de qualquer efeito colateral", () => {
  it("503 sem a flag ligada / sem META_APP_SECRET", async () => {
    delete process.env.INTEGRATION_LEADS_META_ENABLED;
    expect((await post(leadgenPayload("p1", "l1"))).status).toBe(503);
    process.env.INTEGRATION_LEADS_META_ENABLED = "true";
    delete process.env.META_APP_SECRET;
    expect((await post(leadgenPayload("p1", "l1"))).status).toBe(503);
  });

  it("CRÍTICO: assinatura ausente/errada/de outro segredo é rejeitada e NADA é processado (Graph API nunca chamada)", async () => {
    const fetchSpy = vi.fn();
    _setGraphApiFetch(fetchSpy as unknown as typeof fetch);
    const pageId = `zz-page-${++n}`;
    await prisma.leadSourceBinding.create({ data: { orgId: orgA.orgId, campaignId: campaignA, provider: "meta", externalAccountId: pageId } });
    await setPageToken(orgA.orgId, pageId, "page-token-valido");
    const body = leadgenPayload(pageId, `leadgen-${n}`);

    const noSig = await post(body, { signature: null });
    const wrongSig = await post(body, { signature: "sha256=" + "0".repeat(64) });
    const tamperedBody = await post(body + " ", { signature: sign(body) }); // assina o corpo original, envia outro

    expect(noSig.status).toBe(401);
    expect(wrongSig.status).toBe(401);
    expect(tamperedBody.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await prisma.lead.count({ where: { campaignId: campaignA } })).toBe(0);
  });

  it("405 nos métodos não usados", async () => {
    for (const m of ["HEAD", "OPTIONS", "PUT", "PATCH", "DELETE"] as const) {
      expect((await (route[m] as () => Promise<Response>)()).status, m).toBe(405);
    }
  });

  it("página desconhecida (sem LeadSourceBinding): assinatura válida mas resultado unknown_page, sem criar lead", async () => {
    const pageId = `zz-page-desconhecida-${++n}`;
    const body = leadgenPayload(pageId, `leadgen-${n}`);
    const r = await post(body);
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.results[0].status).toBe("unknown_page");
  });

  it("sem Page Access Token cadastrado: resultado no_page_token, sem criar lead", async () => {
    const pageId = `zz-page-sem-token-${++n}`;
    await prisma.leadSourceBinding.create({ data: { orgId: orgA.orgId, campaignId: campaignA, provider: "meta", externalAccountId: pageId } });
    const r = await post(leadgenPayload(pageId, `leadgen-${n}`));
    const json = await r.json();
    expect(json.results[0].status).toBe("no_page_token");
  });

  it("fluxo completo: busca a etapa 2 na Graph API com o Page Access Token da org correta e cria o lead", async () => {
    const pageId = `zz-page-full-${++n}`;
    const leadgenId = `leadgen-full-${n}`;
    await prisma.leadSourceBinding.create({ data: { orgId: orgA.orgId, campaignId: campaignA, provider: "meta", externalAccountId: pageId } });
    await setPageToken(orgA.orgId, pageId, "page-token-correto");
    let capturedToken: string | null = null;
    _setGraphApiFetch(((input: RequestInfo | URL) => {
      capturedToken = new URL(String(input)).searchParams.get("access_token");
      return fakeGraphFetch({ [leadgenId]: [{ name: "full_name", values: ["Carla Reis"] }, { name: "email", values: [`carla${n}@${TAG}.com`] }] })(input);
    }) as unknown as typeof fetch);

    const r = await post(leadgenPayload(pageId, leadgenId));
    const json = await r.json();
    expect(json.results[0].status).toBe("created");
    expect(capturedToken).toBe("page-token-correto");
    const lead = await prisma.lead.findFirst({ where: { campaignId: campaignA, source: "meta_leads" }, orderBy: { id: "desc" } });
    expect(lead?.name).toBe("Carla Reis");
  });

  it("reenvio da mesma notificação (mesmo leadgen_id) é idempotente", async () => {
    const pageId = `zz-page-dup-${++n}`;
    const leadgenId = `leadgen-dup-${n}`;
    await prisma.leadSourceBinding.create({ data: { orgId: orgA.orgId, campaignId: campaignA, provider: "meta", externalAccountId: pageId } });
    await setPageToken(orgA.orgId, pageId, "page-token-dup");
    _setGraphApiFetch(fakeGraphFetch({ [leadgenId]: [{ name: "full_name", values: ["Duplicado"] }] }));
    await post(leadgenPayload(pageId, leadgenId));
    const before = await prisma.lead.count({ where: { campaignId: campaignA } });
    await post(leadgenPayload(pageId, leadgenId));
    expect(await prisma.lead.count({ where: { campaignId: campaignA } })).toBe(before);
  });

  it("CRÍTICO: page_id vinculado à Org A nunca cria lead na Campaign de Org B, mesmo enviado por quem conhece o App Secret", async () => {
    const pageId = `zz-page-cross-${++n}`;
    const leadgenId = `leadgen-cross-${n}`;
    await prisma.leadSourceBinding.create({ data: { orgId: orgA.orgId, campaignId: campaignA, provider: "meta", externalAccountId: pageId } });
    await setPageToken(orgA.orgId, pageId, "page-token-cross");
    _setGraphApiFetch(fakeGraphFetch({ [leadgenId]: [{ name: "full_name", values: ["Cross Tenant"] }] }));
    await post(leadgenPayload(pageId, leadgenId));
    expect(await prisma.lead.count({ where: { campaignId: campaignB } })).toBe(0);
    const created = await prisma.lead.findFirst({ where: { campaignId: campaignA, name: "Cross Tenant" } });
    expect(created).not.toBeNull();
  });

  it("respeita supressão da org", async () => {
    const pageId = `zz-page-supp-${++n}`;
    const leadgenId = `leadgen-supp-${n}`;
    const email = `zz-supp-${n}@${TAG}.com`;
    await prisma.leadSourceBinding.create({ data: { orgId: orgA.orgId, campaignId: campaignA, provider: "meta", externalAccountId: pageId } });
    await setPageToken(orgA.orgId, pageId, "page-token-supp");
    await prisma.suppression.create({ data: { orgId: orgA.orgId, kind: "email", value: email, reason: "manual" } });
    _setGraphApiFetch(fakeGraphFetch({ [leadgenId]: [{ name: "full_name", values: ["Suprimido"] }, { name: "email", values: [email] }] }));
    const r = await post(leadgenPayload(pageId, leadgenId));
    const json = await r.json();
    expect(json.results[0].status).toBe("suppressed");
    expect(await prisma.lead.count({ where: { campaignId: campaignA, email } })).toBe(0);
  });

  it("campanha arquivada: não cria lead", async () => {
    const archivedCampaignId = await makeCampaign(orgA, "archived");
    const pageId = `zz-page-arch-${++n}`;
    const leadgenId = `leadgen-arch-${n}`;
    await prisma.leadSourceBinding.create({ data: { orgId: orgA.orgId, campaignId: archivedCampaignId, provider: "meta", externalAccountId: pageId } });
    await setPageToken(orgA.orgId, pageId, "page-token-arch");
    _setGraphApiFetch(fakeGraphFetch({ [leadgenId]: [{ name: "full_name", values: ["Arquivada"] }] }));
    const r = await post(leadgenPayload(pageId, leadgenId));
    const json = await r.json();
    expect(json.results[0].status).toBe("campaign_archived");
    expect(await prisma.lead.count({ where: { campaignId: archivedCampaignId } })).toBe(0);
  });

  it("429 após excesso de tentativas com assinatura inválida", async () => {
    let last: Response | null = null;
    for (let i = 0; i < 25; i++) last = await post(leadgenPayload(`p${i}`, `l${i}`), { signature: "sha256=" + "0".repeat(64) });
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });
});
