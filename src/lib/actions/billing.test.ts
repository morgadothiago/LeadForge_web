import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { signInAs, signOut } from "@/lib/auth/test-helpers";
import { createCheckoutSession, createPortalSession, signUpAndStartCheckout } from "./billing";

let org: TestOrg;
let memberUserId: string;

beforeAll(async () => {
  org = await createTestOrg("billing-actions");
  memberUserId = randomUUID();
  await prisma.user.create({ data: { id: memberUserId, name: "zz member", email: `zz-member-${memberUserId.slice(0, 8)}@test.local`, role: "provider" } });
  await prisma.membership.create({ data: { userId: memberUserId, orgId: org.orgId, orgRole: "member" } });
});
afterEach(async () => {
  signOut();
  await prisma.subscription.deleteMany({ where: { orgId: org.orgId } });
  await prisma.webhookEvent.deleteMany({ where: { orgId: org.orgId } });
});
afterAll(async () => {
  await prisma.membership.deleteMany({ where: { userId: memberUserId } });
  await prisma.user.deleteMany({ where: { id: memberUserId } });
  await purgeTestOrg(org);
});

describe("createCheckoutSession (SPEC-033)", () => {
  it("sem sessão -> Sessão expirada", async () => {
    const r = await createCheckoutSession({ planKey: "starter", cadence: "monthly" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors._form?.[0]).toMatch(/Sessão expirada/);
  });

  it("member (não owner) -> Sem permissão", async () => {
    await signInAs(memberUserId, { orgId: org.orgId, platformRole: "provider" });
    const r = await createCheckoutSession({ planKey: "starter", cadence: "monthly" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors._form?.[0]).toMatch(/Sem permissão/);
  });

  it("owner -> sucesso, Subscription vira active, url devolvida (modo mock, sem credencial externa)", async () => {
    await signInAs(org.userId, { orgId: org.orgId, platformRole: "provider" });
    const r = await createCheckoutSession({ planKey: "starter", cadence: "monthly" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.url).toContain("session_id=");
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { orgId: org.orgId } });
    expect(sub.status).toBe("active");
  });

  it("owner tentando 'injetar' orgId de outra org no input -> ignorado, checkout continua na própria org (campo não existe no schema)", async () => {
    const org2 = await createTestOrg("billing-actions-other");
    try {
      await signInAs(org.userId, { orgId: org.orgId, platformRole: "provider" });
      const r = await createCheckoutSession({ planKey: "starter", cadence: "monthly", orgId: org2.orgId } as never);
      expect(r.ok).toBe(true);
      const subOrg1 = await prisma.subscription.findUnique({ where: { orgId: org.orgId } });
      const subOrg2 = await prisma.subscription.findUnique({ where: { orgId: org2.orgId } });
      expect(subOrg1?.status).toBe("active");
      expect(subOrg2).toBeNull();
    } finally {
      await purgeTestOrg(org2);
    }
  });

  it("funciona mesmo com a org suspensa (owner precisa reativar a própria assinatura, D-33-3/D-33-4)", async () => {
    await prisma.organization.update({ where: { id: org.orgId }, data: { status: "suspended" } });
    await signInAs(org.userId, { orgId: org.orgId, platformRole: "provider" });
    const r = await createCheckoutSession({ planKey: "starter", cadence: "monthly" });
    expect(r.ok).toBe(true);
    await prisma.organization.update({ where: { id: org.orgId }, data: { status: "active" } });
  });

  it("plano inválido -> erro de campo", async () => {
    await signInAs(org.userId, { orgId: org.orgId, platformRole: "provider" });
    const r = await createCheckoutSession({ planKey: "", cadence: "monthly" });
    expect(r.ok).toBe(false);
  });
});

describe("createPortalSession (SPEC-033)", () => {
  it("member (não owner) -> Sem permissão", async () => {
    await signInAs(memberUserId, { orgId: org.orgId, platformRole: "provider" });
    const r = await createPortalSession();
    expect(r.ok).toBe(false);
  });

  it("owner -> sucesso, url devolvida", async () => {
    await signInAs(org.userId, { orgId: org.orgId, platformRole: "provider" });
    const r = await createPortalSession();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.url).toContain("portal=mock");
  });
});

describe("signUpAndStartCheckout (SPEC-033/D-35-1) — trial ponta a ponta em modo mock, sem credencial externa", () => {
  const created: string[] = [];
  afterAll(async () => {
    const users = await prisma.user.findMany({ where: { email: { in: created } }, select: { id: true, memberships: { select: { orgId: true } } } });
    for (const u of users) {
      for (const m of u.memberships) {
        await prisma.subscription.deleteMany({ where: { orgId: m.orgId } });
        await prisma.membership.deleteMany({ where: { orgId: m.orgId } });
        await prisma.organization.deleteMany({ where: { id: m.orgId } });
      }
      await prisma.user.deleteMany({ where: { id: u.id } });
    }
  });

  it("cria User+Organization+Membership(owner)+Subscription(trialing, 14 dias) e já autentica", async () => {
    const email = `zz-signup-${randomUUID().slice(0, 8)}@test.local`;
    created.push(email);
    const r = await signUpAndStartCheckout({ name: "Fulano", email, password: "senha-forte-123456", orgName: "Empresa Teste Zz", planKey: "starter" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.redirectTo).toBe("/dashboard");
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true, memberships: { select: { orgId: true, orgRole: true } } } });
    expect(user.memberships).toHaveLength(1);
    expect(user.memberships[0].orgRole).toBe("owner");
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { orgId: user.memberships[0].orgId } });
    expect(sub.status).toBe("trialing");
    expect(sub.trialEndsAt).not.toBeNull();
    const days = (sub.trialEndsAt!.getTime() - Date.now()) / (24 * 3600_000);
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
    const org2 = await prisma.organization.findUniqueOrThrow({ where: { id: user.memberships[0].orgId } });
    expect(org2.status).toBe("active");
  });

  it("e-mail já cadastrado -> erro genérico (sem criar org duplicada, sem confirmar existência da conta)", async () => {
    // QA fix (achado menor, SPEC-033 rodada 2): mensagem não pode confirmar "já existe" (anti-enumeração).
    const email = `zz-signup-dup-${randomUUID().slice(0, 8)}@test.local`;
    created.push(email);
    const input = { name: "Fulano", email, password: "senha-forte-123456", orgName: "Empresa Dup", planKey: "starter" };
    const r1 = await signUpAndStartCheckout(input);
    expect(r1.ok).toBe(true);
    const r2 = await signUpAndStartCheckout(input);
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.errors._form?.[0]).toBeDefined();
      const message = JSON.stringify(r2.errors);
      expect(message).not.toMatch(/já existe|already exists|cadastrado/i);
    }
  });

  it("plano 'business' (sem self-service) -> recusado", async () => {
    const email = `zz-signup-biz-${randomUUID().slice(0, 8)}@test.local`;
    const r = await signUpAndStartCheckout({ name: "Fulano", email, password: "senha-forte-123456", orgName: "Empresa Biz", planKey: "business" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.planKey?.[0]).toMatch(/self-service/);
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).toBeNull();
  });

  it("senha curta -> erro de validação", async () => {
    const email = `zz-signup-weak-${randomUUID().slice(0, 8)}@test.local`;
    const r = await signUpAndStartCheckout({ name: "Fulano", email, password: "curta", orgName: "Empresa", planKey: "starter" });
    expect(r.ok).toBe(false);
  });
});
