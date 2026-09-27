import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { signInAs, signOut } from "@/lib/auth/test-helpers";
import { createCourtesyOrganization, reactivateOrganization, suspendOrganization } from "./organizations";

const TAG = "spec031-a";
let org: TestOrg;
let adminUserId: string;

async function createAdmin(): Promise<string> {
  const id = randomUUID();
  await prisma.user.create({ data: { id, name: `zz-${TAG} admin`, email: `zz-${TAG}-${id.slice(0, 8)}@test.local`, role: "platform_admin" } });
  return id;
}

beforeAll(async () => {
  org = await createTestOrg(TAG);
  adminUserId = await createAdmin();
});

afterAll(async () => {
  signOut();
  await prisma.platformAuditLog.deleteMany({ where: { orgId: org.orgId } });
  await prisma.user.deleteMany({ where: { id: adminUserId } });
  await purgeTestOrg(org);
  await prisma.$disconnect();
});

describe("suspendOrganization/reactivateOrganization (SPEC-031) — negação para provider comum", () => {
  it("provider comum recebe ActionResult de erro (nunca muda status da própria org)", async () => {
    await signInAs(org.userId, { orgId: org.orgId, platformRole: "provider" });
    const rSuspend = await suspendOrganization({ orgId: org.orgId, reason: "teste indevido" });
    expect(rSuspend.ok).toBe(false);
    const rReactivate = await reactivateOrganization({ orgId: org.orgId });
    expect(rReactivate.ok).toBe(false);
    const current = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId }, select: { status: true } });
    expect(current.status).toBe("active");
  });

  it("sem sessão -> ActionResult de erro (sessão expirada)", async () => {
    signOut();
    const r = await suspendOrganization({ orgId: org.orgId, reason: "teste" });
    expect(r.ok).toBe(false);
  });
});

describe("suspendOrganization/reactivateOrganization (SPEC-031) — platform_admin", () => {
  beforeAll(async () => {
    await signInAs(adminUserId, { orgId: null, platformRole: "platform_admin" });
  });

  it("valida entrada (reason obrigatório para suspender)", async () => {
    const r = await suspendOrganization({ orgId: org.orgId, reason: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.reason?.[0]).toMatch(/motivo/i);
  });

  it("orgId inválido -> erro de campo", async () => {
    const r = await suspendOrganization({ orgId: "nao-e-uuid", reason: "motivo válido aqui" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.orgId?.[0]).toBeDefined();
  });

  it("org inexistente -> erro (não vaza segredo sobre orgs de outros tenants)", async () => {
    const r = await suspendOrganization({ orgId: "00000000-0000-4000-8000-000000000000", reason: "motivo válido aqui" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors._form?.[0]).toBe("Organização não encontrada.");
  });

  it("suspende, audita (quem/quando/ação/motivo) e o cron passa a ignorar a org", async () => {
    const before = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId }, select: { status: true } });
    expect(before.status).toBe("active");

    const r = await suspendOrganization({ orgId: org.orgId, reason: "inadimplência confirmada" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.status).toBe("suspended");

    const after = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId }, select: { status: true, suspendedReason: true } });
    expect(after.status).toBe("suspended");
    // SPEC-039 (correção QA): suspensão manual grava suspendedReason "manual" (nunca "automatic") — é o
    // sinal que `reminders.ts` usa para nunca disparar o e-mail auto_suspended nesta suspensão.
    expect(after.suspendedReason).toBe("manual");

    const log = await prisma.platformAuditLog.findFirstOrThrow({ where: { orgId: org.orgId, action: "suspend" }, orderBy: { at: "desc" } });
    expect(log.adminUserId).toBe(adminUserId);
    expect(log.reason).toBe("inadimplência confirmada");
    expect(log.at).toBeInstanceOf(Date);

    // reusa o critério já testado na SPEC-030: o cron seleciona orgs com status "active" — dado nunca é apagado.
    const activeOrgIds = (await prisma.organization.findMany({ where: { status: "active" }, select: { id: true } })).map((o) => o.id);
    expect(activeOrgIds).not.toContain(org.orgId);
    const stillThere = await prisma.organization.findUnique({ where: { id: org.orgId } });
    expect(stillThere).not.toBeNull();
  });

  it("reativa e audita", async () => {
    const r = await reactivateOrganization({ orgId: org.orgId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.status).toBe("active");

    const after = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId }, select: { status: true, suspendedReason: true } });
    expect(after.status).toBe("active");
    expect(after.suspendedReason).toBeNull();

    const log = await prisma.platformAuditLog.findFirstOrThrow({ where: { orgId: org.orgId, action: "reactivate" }, orderBy: { at: "desc" } });
    expect(log.adminUserId).toBe(adminUserId);
    expect(log.reason).toBeNull();
  });
});

describe("createCourtesyOrganization (SPEC-040)", () => {
  const createdOrgIds: string[] = [];
  const createdUserIds: string[] = [];

  afterAll(async () => {
    if (createdOrgIds.length) {
      await prisma.platformAuditLog.deleteMany({ where: { orgId: { in: createdOrgIds } } });
      await prisma.subscription.deleteMany({ where: { orgId: { in: createdOrgIds } } });
      await prisma.membership.deleteMany({ where: { orgId: { in: createdOrgIds } } });
      await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
    }
    if (createdUserIds.length) {
      await prisma.passwordResetToken.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  });

  it("provider comum (não platform_admin) recebe erro de permissão, nada é criado", async () => {
    await signInAs(org.userId, { orgId: org.orgId, platformRole: "provider" });
    const email = `zz-spec040-denied-${randomUUID().slice(0, 8)}@test.local`;
    const r = await createCourtesyOrganization({ name: "zz-spec040 denied org", ownerEmail: email, ownerName: "Fulano" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors._form?.[0]).toMatch(/permiss/i);
    const created = await prisma.user.findUnique({ where: { email } });
    expect(created).toBeNull();
  });

  it("sem sessão -> erro (sessão expirada)", async () => {
    signOut();
    const r = await createCourtesyOrganization({ name: "zz-spec040 x", ownerEmail: "zz-spec040-nosession@test.local", ownerName: "X" });
    expect(r.ok).toBe(false);
  });

  it("platform_admin cria User+Organization+Membership(owner)+Subscription(plano courtesy, active), audita e envia token de definição de senha", async () => {
    await signInAs(adminUserId, { orgId: null, platformRole: "platform_admin" });
    const email = `zz-spec040-ok-${randomUUID().slice(0, 8)}@test.local`;
    const r = await createCourtesyOrganization({ name: "zz-spec040 org cortesia", ownerEmail: email, ownerName: "Cortesia Fulano" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdOrgIds.push(r.data.orgId);
    createdUserIds.push(r.data.userId);

    const createdUser = await prisma.user.findUniqueOrThrow({ where: { id: r.data.userId } });
    expect(createdUser.email).toBe(email);
    expect(createdUser.role).toBe("provider");
    expect(createdUser.passwordHash).toBeNull();

    const membership = await prisma.membership.findUniqueOrThrow({ where: { userId_orgId: { userId: r.data.userId, orgId: r.data.orgId } } });
    expect(membership.orgRole).toBe("owner");

    const sub = await prisma.subscription.findUniqueOrThrow({ where: { orgId: r.data.orgId }, include: { plan: true } });
    expect(sub.status).toBe("active");
    expect(sub.plan.key).toBe("courtesy");
    expect(sub.externalCustomerId).toBeNull();
    expect(sub.externalSubscriptionId).toBeNull();

    const limits = sub.plan.limits as Record<string, unknown>;
    expect(limits.maxCampaigns).toBeNull();
    expect(limits.maxWhatsappInstances).toBeNull();
    expect(limits.maxLeadsPerMonth).toBeNull();

    const resetToken = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: r.data.userId } });
    expect(resetToken.usedAt).toBeNull();

    const log = await prisma.platformAuditLog.findFirstOrThrow({ where: { orgId: r.data.orgId, action: "create_courtesy_org" }, orderBy: { at: "desc" } });
    expect(log.adminUserId).toBe(adminUserId);
  });

  it("e-mail duplicado -> erro tratado, nenhuma organização nova é criada", async () => {
    await signInAs(adminUserId, { orgId: null, platformRole: "platform_admin" });
    const email = `zz-spec040-dup-${randomUUID().slice(0, 8)}@test.local`;
    const first = await createCourtesyOrganization({ name: "zz-spec040 org 1", ownerEmail: email, ownerName: "Dup" });
    expect(first.ok).toBe(true);
    if (first.ok) {
      createdOrgIds.push(first.data.orgId);
      createdUserIds.push(first.data.userId);
    }

    const orgCountBefore = await prisma.organization.count();
    const second = await createCourtesyOrganization({ name: "zz-spec040 org 2", ownerEmail: email, ownerName: "Dup" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.errors._form?.[0]).toMatch(/já existe/i);
    const orgCountAfter = await prisma.organization.count();
    expect(orgCountAfter).toBe(orgCountBefore);
  });
});
