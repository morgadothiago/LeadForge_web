import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/channels/system-mail", () => ({ sendSystemEmail: vi.fn(async () => ({ ok: true, messageId: "m" })) }));

import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { signInAs, signOut } from "@/lib/auth/test-helpers";
import { requirePlatformAdmin, requireProviderOrg, ForbiddenError } from "@/lib/auth/require-admin";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";
import { getCampaign, listCampaigns } from "@/lib/queries/campaigns";
import { getLead, listLeads } from "@/lib/queries/leads";
import { updateCampaign } from "@/lib/actions/campaign";
import { listMembers, removeMember, switchActiveOrganization, revokeInvite } from "@/lib/actions/org";
import { clearOrgRateLimits } from "@/lib/org/rate-limit";
import { hashInviteToken } from "@/lib/org/tokens";

/**
 * SPEC-049 — vazamento cross-tenant com UM usuário em DUAS orgs: dados da org A nunca aparecem com a B ativa
 * (e vice-versa), antes e depois da troca de org via `switchActiveOrganization` (que reemite o JWT), mesmo
 * adivinhando IDs; e o JWT antigo de A não "carrega" dados de A depois que o usuário foi removido de A.
 */
let A: TestOrg;
let B: TestOrg;
let multiUserId: string;
let campA: string;
let campB: string;
let leadA: string;
let leadB: string;

async function seed(org: TestOrg) {
  const icp = await prisma.icpProfile.create({ data: { orgId: org.orgId, name: `zz-${org.tag} icp`, niche: "T", signals: ["a"], keywords: [], sources: [], desiredData: [] } });
  const seq = await prisma.sequence.create({ data: { orgId: org.orgId, name: `zz-${org.tag} seq` } });
  const c = await prisma.campaign.create({ data: { orgId: org.orgId, name: `zz-${org.tag} camp`, icpId: icp.id, sequenceId: seq.id, userId: org.userId, status: "paused", autoStart: false } });
  const l = await prisma.lead.create({ data: { campaignId: c.id, name: `zz-${org.tag} lead`, email: `zz-${org.tag}-multi@test.local` } });
  return { campaignId: c.id, leadId: l.id };
}

beforeAll(async () => {
  A = await createTestOrg("multi-a");
  B = await createTestOrg("multi-b");
  ({ campaignId: campA, leadId: leadA } = await seed(A));
  ({ campaignId: campB, leadId: leadB } = await seed(B));
  multiUserId = randomUUID();
  await prisma.user.create({ data: { id: multiUserId, name: "zz multi", email: `zz-multi-${multiUserId.slice(0, 8)}@test.local`, role: "provider" } });
  await prisma.membership.create({ data: { userId: multiUserId, orgId: A.orgId, orgRole: "member" } });
  await prisma.membership.create({ data: { userId: multiUserId, orgId: B.orgId, orgRole: "member" } });
});
afterAll(async () => {
  signOut();
  await prisma.orgInvite.deleteMany({ where: { orgId: { in: [A.orgId, B.orgId] } } });
  await prisma.orgAuditLog.deleteMany({ where: { orgId: { in: [A.orgId, B.orgId] } } });
  await prisma.membership.deleteMany({ where: { userId: multiUserId } });
  await prisma.user.deleteMany({ where: { id: multiUserId } });
  await purgeTestOrg(A);
  await purgeTestOrg(B);
});

describe("usuário em 2 orgs: org ativa isola os dados", () => {
  it("com A ativa só vê A; troca para B (JWT reemitido) e só vê B; IDs adivinhados da outra org => null", async () => {
    clearOrgRateLimits();
    await signInAs(multiUserId, { orgId: A.orgId, platformRole: "provider" });
    expect((await listCampaigns()).map((c) => c.id)).toEqual([campA]);
    expect((await getCampaign(campA))?.id).toBe(campA);
    expect(await getCampaign(campB)).toBeNull();
    expect(await getLead(leadB)).toBeNull();
    expect((await listLeads({})).items.map((l) => l.id)).toEqual([leadA]);

    expect((await switchActiveOrganization({ orgId: B.orgId })).ok).toBe(true);
    expect((await listCampaigns()).map((c) => c.id)).toEqual([campB]);
    expect(await getCampaign(campA)).toBeNull();
    expect(await getLead(leadA)).toBeNull();
    expect((await listLeads({})).items.map((l) => l.id)).toEqual([leadB]);
    // escrita com id da org inativa falha e não altera nada
    const upd = await updateCampaign({ id: campA, name: "roubado" });
    expect(upd.ok).toBe(false);
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campA } })).name).not.toBe("roubado");

    // volta para A: vê A novamente
    expect((await switchActiveOrganization({ orgId: A.orgId })).ok).toBe(true);
    expect((await listCampaigns()).map((c) => c.id)).toEqual([campA]);
  });

  it("scopedPrisma da org ativa nunca devolve a outra, mesmo para o mesmo usuário", async () => {
    expect(await scopedPrisma(B.orgId).campaign.findUnique({ where: { id: campA } })).toBeNull();
    expect(await scopedPrisma(A.orgId).lead.findUnique({ where: { id: leadB } })).toBeNull();
  });

  it("listMembers/removeMember/revokeInvite da org ativa não enxergam nem afetam a outra org", async () => {
    await prisma.orgInvite.create({ data: { orgId: A.orgId, email: "vaza@test.local", tokenHash: hashInviteToken("t-leak-a"), expiresAt: new Date(Date.now() + 60_000) } });
    // owner de B (sessão B) não vê membros/convites de A
    signOut();
    await signInAs(B.userId, { orgId: B.orgId, platformRole: "provider" });
    const r = await listMembers();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.members.map((m) => m.userId).sort()).toEqual([B.userId, multiUserId].sort());
      expect(r.data.invites.some((i) => i.email === "vaza@test.local")).toBe(false);
    }
    const inviteA = await prisma.orgInvite.findFirstOrThrow({ where: { orgId: A.orgId, email: "vaza@test.local" } });
    expect((await revokeInvite({ inviteId: inviteA.id })).ok).toBe(false);
    expect((await removeMember({ userId: A.userId })).ok).toBe(false);
    expect(await prisma.membership.count({ where: { userId: A.userId, orgId: A.orgId } })).toBe(1);
  });

  it("removido de A: JWT antigo de A deixa de dar acesso a A, mas B (ativa por troca) segue isolada e válida", async () => {
    signOut();
    await signInAs(multiUserId, { orgId: A.orgId, platformRole: "provider" });
    expect((await listCampaigns()).length).toBe(1);
    await prisma.membership.delete({ where: { userId_orgId: { userId: multiUserId, orgId: A.orgId } } });
    await expect(listCampaigns()).rejects.toThrow(); // UnauthorizedError
    await expect(getCampaign(campA)).rejects.toThrow();
    signOut();
    await signInAs(multiUserId, { orgId: B.orgId, platformRole: "provider" });
    expect((await listCampaigns()).map((c) => c.id)).toEqual([campB]);
    // não consegue mais trocar para A
    expect((await switchActiveOrganization({ orgId: A.orgId })).ok).toBe(false);
    await prisma.membership.create({ data: { userId: multiUserId, orgId: A.orgId, orgRole: "member" } });
  });

  it("platform_admin inalterado: sem org, só caminho de admin; provider-guards seguem recusando-o", async () => {
    signOut();
    await signInAs(A.userId, { orgId: null, platformRole: "platform_admin" });
    await expect(requireProviderOrg()).rejects.toBeInstanceOf(ForbiddenError);
    expect((await requirePlatformAdmin()).user.platformRole).toBe("platform_admin");
  });
});
