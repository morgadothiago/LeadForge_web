import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { signInAs, signOut } from "@/lib/auth/test-helpers";
import { ForbiddenError } from "@/lib/auth/require-admin";
import { UnauthorizedError } from "@/lib/auth/require-user";
import { getOrganizationDetail, listOrganizations } from "./organizations";

const TAG = "spec031-q";
let orgA: TestOrg;
let orgB: TestOrg;
let adminUserId: string;

async function createAdmin(): Promise<string> {
  const id = randomUUID();
  await prisma.user.create({ data: { id, name: `zz-${TAG} admin`, email: `zz-${TAG}-${id.slice(0, 8)}@test.local`, role: "platform_admin" } });
  return id;
}

beforeAll(async () => {
  orgA = await createTestOrg(`${TAG}-a`);
  orgB = await createTestOrg(`${TAG}-b`);
  adminUserId = await createAdmin();

  // Seed contadores em orgA: 1 campanha ativa com 2 leads, 1 instância WhatsApp conectada.
  const icp = await prisma.icpProfile.create({ data: { orgId: orgA.orgId, name: `zz-${TAG} icp`, niche: "Teste", signals: ["a"], keywords: [], sources: [], desiredData: [] } });
  const campaign = await prisma.campaign.create({ data: { orgId: orgA.orgId, name: `zz-${TAG} camp`, icpId: icp.id, userId: orgA.userId, status: "active", autoStart: false } });
  await prisma.lead.createMany({ data: [{ campaignId: campaign.id, name: "l1" }, { campaignId: campaign.id, name: "l2" }] });
  await prisma.whatsAppInstance.create({
    data: { orgId: orgA.orgId, instanceName: `zz-${TAG}-inst`, number: "5511999999999", status: "connected", webhookToken: randomUUID() },
  });
  await prisma.schedulerRun.create({ data: { orgId: orgA.orgId, startedAt: new Date(), finishedAt: new Date(), status: "ok" } });
});

afterAll(async () => {
  signOut();
  await prisma.user.deleteMany({ where: { id: adminUserId } });
  await purgeTestOrg(orgA);
  await purgeTestOrg(orgB);
  await prisma.$disconnect();
});

describe("listOrganizations/getOrganizationDetail (SPEC-031) — negação para provider comum", () => {
  it("sem sessão -> UnauthorizedError", async () => {
    signOut();
    await expect(listOrganizations()).rejects.toThrow(UnauthorizedError);
    await expect(getOrganizationDetail(orgA.orgId)).rejects.toThrow(UnauthorizedError);
  });

  it("sessão de provider comum -> ForbiddenError em ambas", async () => {
    await signInAs(orgA.userId, { orgId: orgA.orgId, platformRole: "provider" });
    await expect(listOrganizations()).rejects.toThrow(ForbiddenError);
    await expect(getOrganizationDetail(orgA.orgId)).rejects.toThrow(ForbiddenError);
  });
});

describe("listOrganizations/getOrganizationDetail (SPEC-031) — platform_admin", () => {
  beforeAll(async () => {
    await signInAs(adminUserId, { orgId: null, platformRole: "platform_admin" });
  });

  it("lista todas as orgs (cross-tenant), com contadores agregados e dono", async () => {
    const page = await listOrganizations({ search: TAG, pageSize: 50 });
    expect(page.total).toBeGreaterThanOrEqual(2);
    const a = page.items.find((o) => o.id === orgA.orgId);
    const b = page.items.find((o) => o.id === orgB.orgId);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a?.activeCampaigns).toBe(1);
    expect(a?.totalLeads).toBe(2);
    expect(a?.connectedWhatsapp).toBe(1);
    expect(b?.activeCampaigns).toBe(0);
    expect(a?.ownerEmail).toContain(`zz-${TAG}-a`);
  });

  it("filtra por status", async () => {
    await prisma.organization.update({ where: { id: orgB.orgId }, data: { status: "suspended" } });
    const page = await listOrganizations({ search: TAG, status: "suspended", pageSize: 50 });
    expect(page.items.every((o) => o.status === "suspended")).toBe(true);
    expect(page.items.some((o) => o.id === orgB.orgId)).toBe(true);
    expect(page.items.some((o) => o.id === orgA.orgId)).toBe(false);
    await prisma.organization.update({ where: { id: orgB.orgId }, data: { status: "active" } });
  });

  it("getOrganizationDetail devolve contadores + subscriptionStatus + lastActivityAt", async () => {
    const detail = await getOrganizationDetail(orgA.orgId);
    expect(detail).not.toBeNull();
    expect(detail?.activeCampaigns).toBe(1);
    expect(detail?.totalLeads).toBe(2);
    expect(detail?.connectedWhatsapp).toBe(1);
    expect(detail?.subscriptionStatus).toBeNull();
    expect(detail?.lastActivityAt).not.toBeNull();
  });

  it("getOrganizationDetail de org inexistente -> null (nunca vaza detalhe de outra org)", async () => {
    expect(await getOrganizationDetail("00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});
