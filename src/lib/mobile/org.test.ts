import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { resolveOrgId } from "./org";

let A: TestOrg;
let B: TestOrg;
const userId = randomUUID();

beforeAll(async () => {
  A = await createTestOrg("mob-org-a");
  B = await createTestOrg("mob-org-b");
  await prisma.user.create({ data: { id: userId, name: "zz mob", email: `zz-mob-org-${userId.slice(0, 8)}@test.local`, role: "provider" } });
  // B é a mais ANTIGA; A entra depois (findFirst sem orderBy poderia devolver qualquer uma)
  await prisma.membership.create({ data: { userId, orgId: B.orgId, orgRole: "member", createdAt: new Date(Date.now() - 10_000) } });
  await prisma.membership.create({ data: { userId, orgId: A.orgId, orgRole: "member" } });
});
afterAll(async () => {
  await prisma.membership.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await purgeTestOrg(A);
  await purgeTestOrg(B);
});

describe("resolveOrgId (D-049-15)", () => {
  it("sem lastOrgId: Membership mais antiga (determinístico)", async () => {
    for (let i = 0; i < 3; i++) expect(await resolveOrgId(userId)).toBe(B.orgId);
  });
  it("com lastOrgId e ainda membro: usa lastOrgId", async () => {
    await prisma.user.update({ where: { id: userId }, data: { lastOrgId: A.orgId } });
    expect(await resolveOrgId(userId)).toBe(A.orgId);
  });
  it("lastOrgId sem Membership: cai na mais antiga; sem orgs: null", async () => {
    await prisma.user.update({ where: { id: userId }, data: { lastOrgId: randomUUID() } });
    expect(await resolveOrgId(userId)).toBe(B.orgId);
    expect(await resolveOrgId(randomUUID())).toBeNull();
  });
});
