import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { signInAs, signOut } from "@/lib/auth/test-helpers";
import { ForbiddenError, OrgSuspendedError, requireActiveProviderOrg, requireProviderOrg } from "./require-admin";

/**
 * SPEC-033 — `requireActiveProviderOrg()` é o guard usado por toda action de ESCRITA/operação (D-33-3/D-33-4):
 * bloqueia quando `Organization.status !== "active"`, mas `requireProviderOrg()` (usado por LEITURA/`queries`)
 * continua liberado mesmo com a org suspensa — dado nunca fica inacessível, só a escrita.
 */
let org: TestOrg;

beforeAll(async () => {
  org = await createTestOrg("require-active-org");
});
afterEach(() => signOut());
afterAll(() => purgeTestOrg(org));

describe("requireActiveProviderOrg", () => {
  it("org active -> passa e devolve orgId", async () => {
    await signInAs(org.userId, { orgId: org.orgId, platformRole: "provider" });
    const r = await requireActiveProviderOrg();
    expect(r.orgId).toBe(org.orgId);
  });

  it("org suspended -> OrgSuspendedError", async () => {
    await prisma.organization.update({ where: { id: org.orgId }, data: { status: "suspended" } });
    await signInAs(org.userId, { orgId: org.orgId, platformRole: "provider" });
    await expect(requireActiveProviderOrg()).rejects.toBeInstanceOf(OrgSuspendedError);
    // requireProviderOrg (leitura) continua liberado mesmo suspensa.
    await expect(requireProviderOrg()).resolves.toMatchObject({ orgId: org.orgId });
    await prisma.organization.update({ where: { id: org.orgId }, data: { status: "active" } });
  });

  it("org cancelled -> OrgSuspendedError", async () => {
    await prisma.organization.update({ where: { id: org.orgId }, data: { status: "cancelled" } });
    await signInAs(org.userId, { orgId: org.orgId, platformRole: "provider" });
    await expect(requireActiveProviderOrg()).rejects.toBeInstanceOf(OrgSuspendedError);
    await prisma.organization.update({ where: { id: org.orgId }, data: { status: "active" } });
  });

  it("platform_admin (sem org) -> ForbiddenError, nunca OrgSuspendedError (D-33-4: admin não é bloqueado por este gate)", async () => {
    const admin = await prisma.user.findFirst({ where: { role: "platform_admin" } });
    if (!admin) return; // ambiente sem platform_admin cadastrado — não é o foco deste teste
    await signInAs(admin.id, { orgId: null, platformRole: "platform_admin" });
    await expect(requireActiveProviderOrg()).rejects.toBeInstanceOf(ForbiddenError);
  });
});
