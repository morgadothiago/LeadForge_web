import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { signInAs, signOut } from "@/lib/auth/test-helpers";
import { createCheckoutSession, createPortalSession, signUp } from "./billing";

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

describe("signUp (SPEC-062, D-062-1/7) — so o usuario, sem organizacao nem trial", () => {
  const created: string[] = [];
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: created } } });
  });

  it("cria SO o User (nao verificado): nenhuma Organization/Membership/Subscription; redireciona ao /assinar", async () => {
    const email = `zz-signup-${randomUUID().slice(0, 8)}@test.local`;
    created.push(email);
    const orgsBefore = await prisma.organization.count();
    const subsBefore = await prisma.subscription.count();
    const r = await signUp({ name: "Fulano", email, password: "senha-forte-123456" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.redirectTo).toBe("/assinar");
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { role: true, emailVerifiedAt: true, memberships: true } });
    expect(user.role).toBe("provider");
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.memberships).toHaveLength(0);
    expect(await prisma.organization.count()).toBe(orgsBefore);
    expect(await prisma.subscription.count()).toBe(subsBefore);
  });

  it("e-mail já cadastrado -> erro genérico (sem confirmar existência da conta)", async () => {
    const email = `zz-signup-dup-${randomUUID().slice(0, 8)}@test.local`;
    created.push(email);
    const input = { name: "Fulano", email, password: "senha-forte-123456" };
    expect((await signUp(input)).ok).toBe(true);
    const r2 = await signUp(input);
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.errors._form?.[0]).toBeDefined();
      expect(JSON.stringify(r2.errors)).not.toMatch(/já existe|already exists|cadastrado/i);
    }
  });

  it("senha curta -> erro de validação (e nenhum usuario)", async () => {
    const email = `zz-signup-weak-${randomUUID().slice(0, 8)}@test.local`;
    const r = await signUp({ name: "Fulano", email, password: "curta" });
    expect(r.ok).toBe(false);
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });
});
