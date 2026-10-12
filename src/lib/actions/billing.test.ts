import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { signInAs, signOut } from "@/lib/auth/test-helpers";
import { randomCpf } from "@/lib/test-utils/document";
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

describe("signUp (SPEC-065, D-065-23) — usuario + organizacao + trial Free", () => {
  const created: string[] = [];
  afterAll(async () => {
    for (const email of created) {
      const u = await prisma.user.findUnique({ where: { email }, select: { id: true, memberships: { select: { orgId: true } } } });
      if (!u) continue;
      for (const m of u.memberships) {
        await prisma.membership.deleteMany({ where: { orgId: m.orgId } });
        await prisma.orgAuditLog.deleteMany({ where: { orgId: m.orgId } });
        await prisma.organization.deleteMany({ where: { id: m.orgId } });
      }
      await prisma.user.deleteMany({ where: { id: u.id } });
    }
  });
  const pw = { password: "senha-forte-123456", confirmPassword: "senha-forte-123456" };

  it("cria User (nao verificado) + Organization + Membership(owner) + Subscription(free, trialing, +14 dias); redireciona ao /dashboard", async () => {
    const email = `zz-signup-${randomUUID().slice(0, 8)}@test.local`;
    created.push(email);
    const before = Date.now();
    const r = await signUp({ name: "Fulano Silva", email, document: randomCpf(true), ...pw });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.redirectTo).toBe("/dashboard");
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { role: true, emailVerifiedAt: true, memberships: { select: { orgRole: true, org: { select: { name: true, status: true, setupPendingSince: true, subscription: { select: { status: true, trialEndsAt: true, plan: { select: { key: true } } } } } } } } } });
    expect(user.role).toBe("provider");
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.memberships).toHaveLength(1);
    const m = user.memberships[0];
    expect(m.orgRole).toBe("owner");
    expect(m.org).toMatchObject({ name: "Empresa de Fulano", status: "active", setupPendingSince: null });
    expect(m.org.subscription?.status).toBe("trialing");
    expect(m.org.subscription?.plan.key).toBe("free");
    const ms = m.org.subscription!.trialEndsAt!.getTime();
    expect(ms - before).toBeGreaterThan(14 * 24 * 3600_000 - 60_000);
    expect(ms - before).toBeLessThan(14 * 24 * 3600_000 + 60_000);
  });

  it("e-mail já cadastrado -> erro genérico (sem confirmar existência da conta) e nada novo criado", async () => {
    const email = `zz-signup-dup-${randomUUID().slice(0, 8)}@test.local`;
    created.push(email);
    const input = { name: "Fulano", email, document: randomCpf(), ...pw };
    expect((await signUp(input)).ok).toBe(true);
    const orgs = await prisma.organization.count();
    const claims = await prisma.trialClaim.count();
    const r2 = await signUp({ ...input, document: randomCpf() });
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.errors._form?.[0]).toBeDefined();
      expect(JSON.stringify(r2.errors)).not.toMatch(/já existe|already exists|cadastrado/i);
    }
    expect(await prisma.organization.count()).toBe(orgs);
    expect(await prisma.trialClaim.count()).toBe(claims); // falha no meio = nada criado (nem claim)
  });

  it("SPEC-064: senha de exatamente 6 caracteres e aceita; confirmação diferente é rejeitada no servidor (erro no campo confirmPassword)", async () => {
    const bad = `zz-signup-cf-${randomUUID().slice(0, 8)}@test.local`;
    const r = await signUp({ name: "Fulano", email: bad, document: randomCpf(), password: "abc123", confirmPassword: "abc124" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.confirmPassword?.[0]).toBe("As senhas não coincidem.");
    expect(await prisma.user.findUnique({ where: { email: bad } })).toBeNull();
    const ok = `zz-signup-6-${randomUUID().slice(0, 8)}@test.local`;
    created.push(ok);
    expect((await signUp({ name: "Fulano", email: ok, document: randomCpf(), password: "abc123", confirmPassword: "abc123" })).ok).toBe(true);
  });
});
