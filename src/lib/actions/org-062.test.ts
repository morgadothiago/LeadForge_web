import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// SPEC-062 (062a): convite/codigo sem checkout, isolamento multi-tenant com casca, guards e login sem org.
const sent: { to: string; scenario: string }[] = [];
vi.mock("@/lib/channels/system-mail", () => ({
  sendSystemEmail: vi.fn(async (to: string, _s: string, _c: unknown, scenario: string) => {
    sent.push({ to, scenario });
    return { ok: true, messageId: "m1" };
  }),
}));

import { prisma } from "@/lib/prisma";
import { grantAllEntitlements } from "@/lib/test-utils/trial-fixture";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { getCookie, signInAs, signOut, testHeaders } from "@/lib/auth/test-helpers";
import { SESSION_COOKIE } from "@/lib/auth/config";
import { verifySessionToken } from "@/lib/auth/session-token";
import { hashPassword } from "@/lib/auth/password";
import { ForbiddenError, requireActiveProviderOrg, requirePlatformAdmin, requireProviderOrg, requireProviderUser } from "@/lib/auth/require-admin";
import { clearOrgRateLimits } from "@/lib/org/rate-limit";
import { hashInviteToken, newInviteToken } from "@/lib/org/tokens";
import { login } from "./auth";
import { createCheckoutSession, createPortalSession, cancelSubscription, reactivateSubscription } from "./billing";
import { acceptInvite, generateJoinCode, inviteMember, joinByCode, leaveOrganization, listMembers, listMyOrganizations, previewInvite, signUpAndJoin, switchActiveOrganization } from "./org";
import { listOrganizations } from "@/lib/queries/admin/organizations";

let A: TestOrg;
let B: TestOrg;
const users: string[] = [];
const orgs: string[] = [];
const emailsToClean: string[] = [];
const err = (r: { ok: boolean; errors?: Record<string, string[]> }) => (r.ok ? "" : Object.values(r.errors ?? {}).flat().join(" | "));
const sessionOrg = async () => (await verifySessionToken(getCookie(SESSION_COOKIE)))?.orgId;

async function mkUser(tag: string, opts: { password?: string; verified?: boolean; role?: "provider" | "platform_admin" } = {}) {
  const id = randomUUID();
  const email = `zz-062-${tag}-${id.slice(0, 8)}@test.local`;
  await prisma.user.create({ data: { id, name: `zz ${tag}`, email, role: opts.role ?? "provider", passwordHash: opts.password ? await hashPassword(opts.password) : null, emailVerifiedAt: opts.verified === false ? null : new Date() } });
  users.push(id);
  return { id, email };
}
async function mkOrg(ownerId: string | null, o: { shell?: boolean; sub?: "active" | "incomplete" | "none"; status?: "active" | "suspended"; role?: "owner" | "member" } = {}): Promise<string> {
  const id = randomUUID();
  await prisma.organization.create({ data: { id, name: o.shell ? "Organização em configuração" : `zz org ${id.slice(0, 6)}`, slug: o.shell ? `pendente-${id.slice(0, 8)}` : `zz-062-${id.slice(0, 8)}`, status: o.status ?? "active", setupPendingSince: o.shell ? new Date() : null } });
  orgs.push(id);
  if (ownerId) await prisma.membership.create({ data: { userId: ownerId, orgId: id, orgRole: o.role ?? "owner" } });
  if (o.sub !== "none") {
    const plan = await prisma.plan.findUniqueOrThrow({ where: { key: "starter" } });
    await prisma.subscription.create({ data: { orgId: id, planId: plan.id, status: o.sub ?? "active" } });
  }
  return id;
}
const subCount = () => prisma.subscription.count();

beforeAll(async () => {
  A = await createTestOrg("062-a");
  B = await createTestOrg("062-b");
  const plan = await prisma.plan.findUniqueOrThrow({ where: { key: "starter" } });
  for (const o of [A, B]) await prisma.subscription.create({ data: { orgId: o.orgId, planId: plan.id, status: "active" } });
  for (const o of [A, B]) await grantAllEntitlements(o.orgId); // SPEC-069b: sem limite de membros aqui
  process.env.TRUSTED_PROXY_IP_HEADER = "x-real-ip";
});
beforeEach(() => {
  clearOrgRateLimits();
  sent.length = 0;
  testHeaders.current = new Headers({ "x-real-ip": `7.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
});
afterEach(() => signOut());
afterAll(async () => {
  const all = [A.orgId, B.orgId, ...orgs];
  await prisma.orgInvite.deleteMany({ where: { orgId: { in: all } } });
  await prisma.orgAuditLog.deleteMany({ where: { orgId: { in: all } } });
  await prisma.emailDispatchLog.deleteMany({ where: { userId: { in: users } } });
  await prisma.subscription.deleteMany({ where: { orgId: { in: all } } });
  await prisma.membership.deleteMany({ where: { orgId: { in: orgs } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
  await prisma.user.deleteMany({ where: { OR: [{ id: { in: users } }, { email: { in: emailsToClean } }] } });
  await purgeTestOrg(A);
  await purgeTestOrg(B);
});

describe("convite/codigo entram SEM checkout (D-062-4/15)", () => {
  it("convidado logado SEM org aceita o convite: Membership, sessao na org, nenhuma Subscription nova, nenhum checkout", async () => {
    const guest = await mkUser("inv");
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    expect((await inviteMember({ email: guest.email, orgRole: "member" })).ok).toBe(true);
    const inv = await prisma.orgInvite.findFirstOrThrow({ where: { orgId: A.orgId, email: guest.email } });
    // token real so existe no e-mail; reemite um convite com token conhecido
    const { token, hash } = newInviteToken();
    await prisma.orgInvite.update({ where: { id: inv.id }, data: { tokenHash: hash } });
    const subsBefore = await subCount();
    await signInAs(guest.id, { orgId: null, platformRole: "provider" });
    const r = await acceptInvite({ token });
    expect(r).toEqual({ ok: true, data: { orgId: A.orgId, redirectTo: "/dashboard" } });
    expect(await sessionOrg()).toBe(A.orgId);
    expect(await prisma.membership.count({ where: { userId: guest.id, orgId: A.orgId, orgRole: "member" } })).toBe(1);
    expect(await subCount()).toBe(subsBefore);
    expect(await prisma.organization.count({ where: { memberships: { some: { userId: guest.id } }, setupPendingSince: { not: null } } })).toBe(0);
    expect(await prisma.orgInvite.findUniqueOrThrow({ where: { tokenHash: hashInviteToken(token) } }).then((i) => i.usedByUserId)).toBe(guest.id);
  });

  it("codigo de entrada: usuario logado sem org entra sem checkout; ja membro recusado; rate limit por usuario", async () => {
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    const g = await generateJoinCode({ maxUses: 50 });
    if (!g.ok) throw new Error("gen");
    const u = await mkUser("code");
    const subsBefore = await subCount();
    await signInAs(u.id, { orgId: null, platformRole: "provider" });
    expect((await joinByCode({ code: g.data.code })).ok).toBe(true);
    expect(await sessionOrg()).toBe(A.orgId);
    expect(await subCount()).toBe(subsBefore);
    await signInAs(u.id, { orgId: A.orgId, platformRole: "provider" });
    expect(err(await joinByCode({ code: g.data.code }))).toMatch(/já participa/);
    // rate limit: 10/15min por usuario
    const spammer = await mkUser("spam");
    await signInAs(spammer.id, { orgId: null, platformRole: "provider" });
    let last = "";
    for (let i = 0; i < 12; i++) last = err(await joinByCode({ code: "ZZZZZZZZZZZZZZZZZZZZ" }));
    expect(last).toMatch(/Muitas tentativas/);
  });

  it("convite para OUTRO e-mail e recusado; usuario ja membro recusado", async () => {
    const owner = await mkUser("inv-other");
    const intruder = await mkUser("inv-intruder");
    const { token, hash } = newInviteToken();
    await prisma.orgInvite.create({ data: { orgId: A.orgId, email: owner.email, orgRole: "member", tokenHash: hash, expiresAt: new Date(Date.now() + 86400_000) } });
    await signInAs(intruder.id, { orgId: null, platformRole: "provider" });
    expect(err(await acceptInvite({ token }))).toMatch(/inválido/);
    expect(await prisma.membership.count({ where: { userId: intruder.id } })).toBe(0);
    await prisma.membership.create({ data: { userId: owner.id, orgId: A.orgId, orgRole: "member" } });
    await signInAs(owner.id, { orgId: A.orgId, platformRole: "provider" });
    expect(err(await acceptInvite({ token }))).toMatch(/já participa/);
  });

  it("org SUSPENSA (assinatura em atraso) continua aceitando convite", async () => {
    const susp = await mkOrg(null, { status: "suspended", sub: "active" });
    const u = await mkUser("susp-inv");
    const { token, hash } = newInviteToken();
    await prisma.orgInvite.create({ data: { orgId: susp, email: u.email, orgRole: "member", tokenHash: hash, expiresAt: new Date(Date.now() + 86400_000) } });
    await signInAs(u.id, { orgId: null, platformRole: "provider" });
    expect((await acceptInvite({ token })).ok).toBe(true);
    expect(await sessionOrg()).toBe(susp);
  });

  it("CASCA recusa convite (acceptInvite/previewInvite) e codigo (joinByCode), sem consumir o uso do codigo", async () => {
    const shell = await mkOrg(null, { shell: true, sub: "active" });
    const code = "ZS062" + randomUUID().replace(/[^a-z0-9]/g, "").toUpperCase().slice(0, 15);
    await prisma.organization.update({ where: { id: shell }, data: { joinCode: code, joinCodeExpiresAt: new Date(Date.now() + 86400_000), joinCodeMaxUses: 5, joinCodeUses: 0 } });
    const u = await mkUser("shell-join");
    const { token, hash } = newInviteToken();
    await prisma.orgInvite.create({ data: { orgId: shell, email: u.email, orgRole: "member", tokenHash: hash, expiresAt: new Date(Date.now() + 86400_000) } });
    await signInAs(u.id, { orgId: null, platformRole: "provider" });
    expect(err(await acceptInvite({ token }))).toMatch(/inválido/);
    expect(err(await joinByCode({ code }))).toMatch(/inválido|expirado/);
    expect(await prisma.membership.count({ where: { userId: u.id } })).toBe(0);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: shell } })).joinCodeUses).toBe(0);
    const pv = await previewInvite({ token });
    expect(pv.ok && pv.data).toEqual({ valid: false });
    // convite nao foi queimado
    expect((await prisma.orgInvite.findUniqueOrThrow({ where: { tokenHash: hash } })).usedAt).toBeNull();
  });

  it("platform_admin nao usa acceptInvite/joinByCode; sem sessao -> Sessao expirada", async () => {
    const admin = await mkUser("adm", { role: "platform_admin" });
    await signInAs(admin.id, { orgId: null, platformRole: "platform_admin" });
    expect(err(await acceptInvite({ token: "x" }))).toMatch(/Sem permissão/);
    expect(err(await joinByCode({ code: "x" }))).toMatch(/Sem permissão/);
    signOut();
    expect(err(await joinByCode({ code: "x" }))).toMatch(/Sessão expirada/);
  });

  it("signUpAndJoin por convite continua: e-mail verificado, entra na org, sem Subscription nova", async () => {
    const email = `zz-062-su-${randomUUID().slice(0, 8)}@test.local`;
    emailsToClean.push(email);
    const { token, hash } = newInviteToken();
    await prisma.orgInvite.create({ data: { orgId: A.orgId, email, orgRole: "member", tokenHash: hash, expiresAt: new Date(Date.now() + 86400_000) } });
    const subsBefore = await subCount();
    const r = await signUpAndJoin({ name: "Novo", password: "uma-senha-bem-longa-1", confirmPassword: "uma-senha-bem-longa-1", token });
    expect(r.ok).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt).not.toBeNull();
    expect(await sessionOrg()).toBe(A.orgId);
    expect(await subCount()).toBe(subsBefore);
    // welcome do convidado nao manda "escolha seu plano"
    expect(sent.some((s) => s.scenario === "welcome")).toBe(true);
  });
});

describe("regressao de isolamento multi-tenant com casca (D-062-5, obrigatoria)", () => {
  // X so em A, Y so em B, Z so na casca C (paga), W em A + casca propria
  let X: { id: string; email: string }, Y: { id: string; email: string }, Z: { id: string; email: string }, W: { id: string; email: string };
  let C: string, CW: string;
  beforeAll(async () => {
    X = await mkUser("x");
    Y = await mkUser("y");
    Z = await mkUser("z", { password: "senha-de-teste-123" });
    W = await mkUser("w", { password: "senha-de-teste-123" });
    await prisma.membership.create({ data: { userId: X.id, orgId: A.orgId, orgRole: "member" } });
    await prisma.membership.create({ data: { userId: Y.id, orgId: B.orgId, orgRole: "member" } });
    C = await mkOrg(Z.id, { shell: true, sub: "active" });
    await prisma.membership.create({ data: { userId: W.id, orgId: A.orgId, orgRole: "member", createdAt: new Date(Date.now() + 1000) } });
    CW = await mkOrg(W.id, { shell: true, sub: "active" });
  });

  it("listMyOrganizations/seletor: X ve so A, Y so B, W (A + casca) so A; a casca nunca aparece", async () => {
    await signInAs(X.id, { orgId: A.orgId, platformRole: "provider" });
    const lx = await listMyOrganizations();
    expect(lx.ok && lx.data.organizations.map((o) => o.orgId)).toEqual([A.orgId]);
    await signInAs(Y.id, { orgId: B.orgId, platformRole: "provider" });
    const ly = await listMyOrganizations();
    expect(ly.ok && ly.data.organizations.map((o) => o.orgId)).toEqual([B.orgId]);
    await signInAs(W.id, { orgId: A.orgId, platformRole: "provider" });
    const lw = await listMyOrganizations();
    expect(lw.ok && lw.data.organizations.map((o) => o.orgId)).toEqual([A.orgId]);
  });

  it("switchActiveOrganization para a casca: mesma resposta de 'nao existe'; sessao permanece", async () => {
    await signInAs(W.id, { orgId: A.orgId, platformRole: "provider" });
    const toShell = err(await switchActiveOrganization({ orgId: CW }));
    const ghost = err(await switchActiveOrganization({ orgId: randomUUID() }));
    expect(toShell).toBe(ghost);
    expect(toShell).not.toBe("");
    expect(await sessionOrg()).toBe(A.orgId);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: W.id } })).lastOrgId).not.toBe(CW);
  });

  it("leaveOrganization nao conta a casca como 'outra organizacao' (W continua sem poder sair da unica org real)", async () => {
    await signInAs(W.id, { orgId: A.orgId, platformRole: "provider" });
    expect(err(await leaveOrganization())).toMatch(/única organização/);
    expect(await prisma.membership.count({ where: { userId: W.id, orgId: A.orgId } })).toBe(1);
  });

  it("login: Z (so casca) entra com sessao orgId=null; W abre a org real, nunca a casca", async () => {
    testHeaders.current = new Headers({ "x-real-ip": "6.6.6.1" });
    const rz = await login({ email: Z.email, password: "senha-de-teste-123" });
    expect(rz.ok).toBe(true);
    expect(await sessionOrg()).toBeNull();
    signOut();
    await prisma.user.update({ where: { id: W.id }, data: { lastOrgId: CW } }); // lastOrgId apontando para a casca
    testHeaders.current = new Headers({ "x-real-ip": "6.6.6.2" });
    expect((await login({ email: W.email, password: "senha-de-teste-123" })).ok).toBe(true);
    expect(await sessionOrg()).toBe(A.orgId);
  });

  it("Z (sem org na sessao) nao acessa dado de A/B por nenhuma action por org, mesmo passando orgId no input", async () => {
    await signInAs(Z.id, { orgId: null, platformRole: "provider" });
    for (const r of [
      await listMembers(),
      await inviteMember({ email: "a@b.co", orgId: A.orgId } as never),
      await generateJoinCode({ orgId: A.orgId } as never),
      await createCheckoutSession({ planKey: "starter", cadence: "monthly", orgId: A.orgId } as never),
      await createPortalSession(),
      await cancelSubscription(),
      await reactivateSubscription(),
      await listMyOrganizations(),
      await switchActiveOrganization({ orgId: A.orgId }),
    ]) {
      expect(r.ok).toBe(false);
      expect(err(r)).toMatch(/Sem permissão/);
    }
    expect((await prisma.subscription.findUniqueOrThrow({ where: { orgId: A.orgId } })).status).toBe("active");
  });

  it("admin: lista padrao esconde casca SEM pagamento e mostra casca PAGA identificada (setupPendingSince)", async () => {
    const unpaid = await mkOrg(null, { shell: true, sub: "incomplete" });
    const none = await mkOrg(null, { shell: true, sub: "none" });
    const admin = await mkUser("admin-list", { role: "platform_admin" });
    await signInAs(admin.id, { orgId: null, platformRole: "platform_admin" });
    const page = await listOrganizations({ pageSize: 100, search: "" });
    const ids = new Set(page.items.map((o) => o.id));
    expect(ids.has(unpaid)).toBe(false);
    expect(ids.has(none)).toBe(false);
    expect(ids.has(C)).toBe(true);
    expect(page.items.find((o) => o.id === C)?.setupPendingSince).not.toBeNull();
    expect(page.items.find((o) => o.id === A.orgId)?.setupPendingSince).toBeNull();
  });
});

describe("guards (D-062-8)", () => {
  it("requireProviderUser aceita provider SEM org; requireProviderOrg/requireActiveProviderOrg continuam recusando (inalterados)", async () => {
    const u = await mkUser("g1");
    await signInAs(u.id, { orgId: null, platformRole: "provider" });
    const r = await requireProviderUser();
    expect(r.user.id).toBe(u.id);
    expect(r.orgId).toBeNull();
    await expect(requireProviderOrg()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requireActiveProviderOrg()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("requireProviderUser com org devolve a org da sessao; admin recusado em requireProviderUser; requirePlatformAdmin intacto", async () => {
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    expect((await requireProviderUser()).orgId).toBe(A.orgId);
    const admin = await mkUser("g-adm", { role: "platform_admin" });
    await signInAs(admin.id, { orgId: null, platformRole: "platform_admin" });
    await expect(requireProviderUser()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requireProviderOrg()).rejects.toBeInstanceOf(ForbiddenError);
    expect((await requirePlatformAdmin()).user.id).toBe(admin.id);
  });

  it("sem sessao: requireProviderUser lanca UnauthorizedError", async () => {
    signOut();
    await expect(requireProviderUser()).rejects.toMatchObject({ name: "UnauthorizedError" });
  });
});

describe("login sem organizacao (D-062-8) e destino por estado", () => {
  const PASS = "senha-de-teste-123";
  const run = async (email: string, ip: string) => {
    testHeaders.current = new Headers({ "x-real-ip": ip });
    return login({ email, password: PASS });
  };

  it("sem org e sem casca: entra (nao recusa mais), sessao orgId=null, vai ao /assinar", async () => {
    const u = await mkUser("l1", { password: PASS });
    const r = await run(u.email, "5.5.5.1");
    expect(r).toEqual({ ok: true, data: { redirectTo: "/assinar" } });
    expect(await sessionOrg()).toBeNull();
  });

  it("casca incomplete -> /assinar/retorno; casca paga -> /organizacao/nova; org real -> /dashboard", async () => {
    const a = await mkUser("l2", { password: PASS });
    await mkOrg(a.id, { shell: true, sub: "incomplete" });
    expect(await run(a.email, "5.5.5.2")).toEqual({ ok: true, data: { redirectTo: "/assinar/retorno" } });
    const b = await mkUser("l3", { password: PASS });
    await mkOrg(b.id, { shell: true, sub: "active" });
    expect(await run(b.email, "5.5.5.3")).toEqual({ ok: true, data: { redirectTo: "/organizacao/nova" } });
    const c = await mkUser("l4", { password: PASS });
    const org = await mkOrg(c.id, { sub: "active" });
    expect(await run(c.email, "5.5.5.4")).toEqual({ ok: true, data: { redirectTo: "/dashboard" } });
    expect(await sessionOrg()).toBe(org);
  });

  it("usuario removido da org (D-062-22) loga de novo e cai em /assinar, em vez de erro", async () => {
    const u = await mkUser("l5", { password: PASS });
    const org = await mkOrg(u.id, { role: "member", sub: "active" });
    await prisma.membership.deleteMany({ where: { userId: u.id, orgId: org } });
    expect(await run(u.email, "5.5.5.5")).toEqual({ ok: true, data: { redirectTo: "/assinar" } });
  });

  it("platform_admin -> /admin/organizacoes (inalterado)", async () => {
    const admin = await mkUser("l6", { password: PASS, role: "platform_admin" });
    expect(await run(admin.email, "5.5.5.6")).toEqual({ ok: true, data: { redirectTo: "/admin/organizacoes" } });
    expect(await sessionOrg()).toBeNull();
  });

  it("`next` seguro continua respeitado", async () => {
    const u = await mkUser("l7", { password: PASS });
    await mkOrg(u.id, { sub: "active" });
    testHeaders.current = new Headers({ "x-real-ip": "5.5.5.7" });
    expect(await login({ email: u.email, password: PASS, next: "/leads" })).toEqual({ ok: true, data: { redirectTo: "/leads" } });
  });
});
