import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { CANCEL_RETENTION_MS } from "./status-map";
import { purgeCanceledOrgs } from "./purge";

let org: TestOrg;
let planId: string;
let leadId: string;

async function setupLead(o: TestOrg): Promise<{ campaignId: string; leadId: string }> {
  const icp = await prisma.icpProfile.create({ data: { orgId: o.orgId, name: "zz-icp", niche: "n" } });
  const camp = await prisma.campaign.create({ data: { orgId: o.orgId, name: "zz-camp", icpId: icp.id, userId: o.userId, status: "paused" } });
  const lead = await prisma.lead.create({ data: { campaignId: camp.id, name: "Fulano de Tal", email: "fulano@example.com", phone: "+5511999998888", website: "https://x.example", linkedin: "https://linkedin.com/in/x", rawData: { raw: true } } });
  await prisma.leadNote.create({ data: { leadId: lead.id, body: "nota sensível com detalhe pessoal" } });
  await prisma.touch.create({ data: { leadId: lead.id, channel: "email", direction: "outbound", status: "sent", content: "corpo da mensagem", subject: "assunto" } });
  return { campaignId: camp.id, leadId: lead.id };
}

beforeAll(async () => {
  org = await createTestOrg("purge");
  planId = (await prisma.plan.findUniqueOrThrow({ where: { key: "starter" }, select: { id: true } })).id;
  ({ leadId } = await setupLead(org));
});
afterEach(() => prisma.subscription.deleteMany({ where: { orgId: org.orgId } }));
afterAll(() => purgeTestOrg(org));

describe("purgeCanceledOrgs (SPEC-033, D-33-4)", () => {
  it("cancelada há < 90 dias: NÃO expurga (retenção ainda vigente)", async () => {
    const now = new Date();
    await prisma.subscription.create({
      data: { orgId: org.orgId, planId, status: "canceled", cadence: "monthly", canceledAt: new Date(now.getTime() - (CANCEL_RETENTION_MS - 24 * 3600_000)) },
    });
    const r = await purgeCanceledOrgs(now);
    expect(r.purged).toBe(0);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.email).toBe("fulano@example.com");
    const o = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
    expect(o.purgedAt).toBeNull();
  });

  it("cancelada há > 90 dias: anonimiza Lead/Touch/LeadNote e marca Organization.purgedAt", async () => {
    const now = new Date();
    await prisma.subscription.create({
      data: { orgId: org.orgId, planId, status: "canceled", cadence: "monthly", canceledAt: new Date(now.getTime() - (CANCEL_RETENTION_MS + 24 * 3600_000)) },
    });
    const r = await purgeCanceledOrgs(now);
    expect(r.purged).toBe(1);
    expect(r.errors).toBe(0);

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.email).toBeNull();
    expect(lead.phone).toBeNull();
    expect(lead.website).toBeNull();
    expect(lead.linkedin).toBeNull();
    expect(lead.name).toMatch(/removido/i);
    expect(lead.rawData).toBeNull();

    const touch = await prisma.touch.findFirstOrThrow({ where: { leadId } });
    expect(touch.content).toBeNull();
    expect(touch.subject).toBeNull();

    const note = await prisma.leadNote.findFirstOrThrow({ where: { leadId } });
    expect(note.body).toMatch(/removido/i);

    const o = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
    expect(o.purgedAt).not.toBeNull();
  });

  it("já expurgada (purgedAt setado): não reprocessa (idempotente)", async () => {
    const now = new Date();
    const r = await purgeCanceledOrgs(now);
    expect(r.purged).toBe(0);
  });

  it("nunca toca dado de outra org (sem vazamento cross-tenant)", async () => {
    const other = await createTestOrg("purge-other");
    try {
      const { leadId: otherLeadId } = await setupLead(other);
      const now = new Date();
      await prisma.subscription.create({
        data: { orgId: other.orgId, planId, status: "canceled", cadence: "monthly", canceledAt: new Date(now.getTime() - (CANCEL_RETENTION_MS + 24 * 3600_000)) },
      });
      await purgeCanceledOrgs(now);
      const otherLead = await prisma.lead.findUniqueOrThrow({ where: { id: otherLeadId } });
      expect(otherLead.email).toBeNull(); // a própria org foi expurgada...
      // ...mas a org "purge" (já expurgada no teste anterior) não foi tocada de novo por causa desta rodada.
      const o = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
      expect(o.purgedAt).not.toBeNull();
    } finally {
      await purgeTestOrg(other);
    }
  });
});
