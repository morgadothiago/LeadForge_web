import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sent: { to: string; subject: string; html: string; text: string; scenario: string }[] = [];
let failProvider = false;
vi.mock("@/lib/channels/system-mail", () => ({
  sendSystemEmail: vi.fn(async (to: string, subject: string, content: { html: string; text: string }, scenario: string) => {
    if (failProvider) throw new Error("provider down");
    sent.push({ to, subject, html: content.html, text: content.text, scenario });
    return { ok: true, messageId: "m1" };
  }),
}));

import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { signInAs, signOut } from "@/lib/auth/test-helpers";
import { clearOrgRateLimits } from "@/lib/org/rate-limit";
import { newInviteToken } from "@/lib/org/tokens";
import { notifyOrgMemberEvent, ORG_JOIN_EMAILS_PER_HOUR } from "@/lib/org/notify";
import { acceptInvite, changeMemberRole, generateJoinCode, joinByCode, leaveOrganization, removeMember, signUpAndJoin } from "./org";

let A: TestOrg; // owner uA
let B: TestOrg; // outra org (owner proprio, nunca deve receber nada de A)
let O2: { id: string; email: string };
const extraUsers: string[] = [];
const createdEmails: string[] = [];

async function mkUser(tag: string, orgId?: string, role: "owner" | "member" = "member") {
  const id = randomUUID();
  const email = `zz-orgn-${tag}-${id.slice(0, 8)}@test.local`;
  await prisma.user.create({ data: { id, name: `zz ${tag}`, email, role: "provider" } });
  extraUsers.push(id);
  if (orgId) await prisma.membership.create({ data: { userId: id, orgId, orgRole: role } });
  return { id, email };
}
const asOwner = () => signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
const ownerEmails = async () => (await prisma.user.findMany({ where: { id: { in: [A.userId, O2.id] } }, select: { email: true } })).map((u) => u.email);
const byScenario = (s: string) => sent.filter((e) => e.scenario === s);

beforeAll(async () => {
  A = await createTestOrg("orgn-a");
  B = await createTestOrg("orgn-b");
  O2 = await mkUser("o2", A.orgId, "owner");
  await prisma.subscription.create({ data: { orgId: A.orgId, planId: (await prisma.plan.findUniqueOrThrow({ where: { key: "starter" } })).id, status: "active", cadence: "monthly" } });
});
beforeEach(() => {
  clearOrgRateLimits();
  sent.length = 0;
  failProvider = false;
});
afterEach(() => signOut());
afterAll(async () => {
  await prisma.emailDispatchLog.deleteMany({ where: { orgId: { in: [A.orgId, B.orgId] } } });
  await prisma.orgInvite.deleteMany({ where: { orgId: A.orgId } });
  await prisma.orgAuditLog.deleteMany({ where: { orgId: { in: [A.orgId, B.orgId] } } });
  await prisma.subscription.deleteMany({ where: { orgId: A.orgId } });
  await prisma.user.updateMany({ where: { id: { in: extraUsers } }, data: { lastOrgId: null } });
  await prisma.membership.deleteMany({ where: { userId: { in: extraUsers } } });
  await prisma.user.deleteMany({ where: { OR: [{ id: { in: extraUsers } }, { email: { in: createdEmails } }] } });
  await purgeTestOrg(A);
  await purgeTestOrg(B);
});

describe("SPEC-056: e-mails de eventos de equipe aos owners", () => {
  it("acceptInvite: 1 e-mail org_member_joined por owner; link absoluto; duplo clique nao duplica", async () => {
    const guest = await mkUser("inv", B.orgId);
    const { token, hash } = newInviteToken();
    await prisma.orgInvite.create({ data: { orgId: A.orgId, email: guest.email, orgRole: "member", tokenHash: hash, expiresAt: new Date(Date.now() + 86400_000), createdByUserId: A.userId } });
    await signInAs(guest.id, { orgId: B.orgId, platformRole: "provider" });
    expect((await acceptInvite({ token })).ok).toBe(true);
    expect((await acceptInvite({ token })).ok).toBe(false);
    const ev = byScenario("org_member_joined");
    expect(ev.map((e) => e.to).sort()).toEqual((await ownerEmails()).sort());
    expect(ev[0].text).toContain(guest.email);
    expect(ev[0].text).toMatch(/https?:\/\/[^\s]+\/configuracoes\/equipe/);
    expect(ev[0].html).toContain("/configuracoes/equipe");
    expect(sent.some((e) => e.to === guest.email)).toBe(false); // D-056-1
  });

  it("joinByCode: avisa os owners; falha (codigo invalido) nao envia", async () => {
    await asOwner();
    const g = await generateJoinCode({ maxUses: 5 });
    if (!g.ok) throw new Error("setup");
    const u = await mkUser("code", B.orgId);
    signOut();
    await signInAs(u.id, { orgId: B.orgId, platformRole: "provider" });
    expect((await joinByCode({ code: "ZZZZZZZZZZZZZZZZZZZZ" })).ok).toBe(false);
    expect(byScenario("org_member_joined")).toHaveLength(0);
    expect((await joinByCode({ code: g.data.code })).ok).toBe(true);
    expect(byScenario("org_member_joined")).toHaveLength(2);
  });

  it("signUpAndJoin por convite (SPEC-062: so convite): avisa os owners", async () => {
    const email = `zz-orgn-su-${randomUUID().slice(0, 8)}@test.local`;
    createdEmails.push(email);
    const { token, hash } = newInviteToken();
    await prisma.orgInvite.create({ data: { orgId: A.orgId, email, orgRole: "member", tokenHash: hash, expiresAt: new Date(Date.now() + 86400_000) } });
    signOut();
    const r = await signUpAndJoin({ name: "Novo Membro", password: "Senha-Forte-123!", token });
    expect(r.ok).toBe(true);
    const ev = byScenario("org_member_joined");
    expect(ev.map((e) => e.to).sort()).toEqual((await ownerEmails()).sort());
    expect(ev[0].text).toContain("Novo Membro");
  });

  it("removeMember: avisa owners exceto o ator; membro removido nao recebe; recusa nao envia", async () => {
    const m = await mkUser("rm", A.orgId);
    await asOwner();
    expect((await removeMember({ userId: randomUUID() })).ok).toBe(false);
    expect(sent).toHaveLength(0);
    expect((await removeMember({ userId: m.id })).ok).toBe(true);
    const ev = byScenario("org_member_removed");
    expect(ev.map((e) => e.to)).toEqual([O2.email]); // ator (uA) excluido
    expect(sent.some((e) => e.to === m.email)).toBe(false);
  });

  it("leaveOrganization: avisa os outros owners", async () => {
    const m = await mkUser("lv", A.orgId);
    await prisma.membership.create({ data: { userId: m.id, orgId: B.orgId, orgRole: "member" } });
    await signInAs(m.id, { orgId: A.orgId, platformRole: "provider" });
    expect((await leaveOrganization()).ok).toBe(true);
    const ev = byScenario("org_member_left");
    expect(ev.map((e) => e.to).sort()).toEqual((await ownerEmails()).sort());
    expect(ev[0].subject).toMatch(/saiu/);
  });

  it("changeMemberRole: avisa so outros owners; sem mudanca real ou recusa nao envia", async () => {
    const m = await mkUser("rl", A.orgId);
    await asOwner();
    expect((await changeMemberRole({ userId: m.id, orgRole: "member" })).ok).toBe(true); // sem mudanca
    expect(sent).toHaveLength(0);
    expect((await changeMemberRole({ userId: m.id, orgRole: "owner" })).ok).toBe(true);
    const ev = byScenario("org_role_changed");
    // owners agora: uA (ator, excluido), O2 e o proprio m (afetado, excluido)
    expect(ev.map((e) => e.to)).toEqual([O2.email]);
    expect(ev[0].text).toMatch(/de membro para owner/);
  });

  it("falha do provider nao propaga nem reverte a acao", async () => {
    const m = await mkUser("fp", A.orgId);
    await asOwner();
    failProvider = true;
    expect((await removeMember({ userId: m.id })).ok).toBe(true);
    expect(await prisma.membership.count({ where: { userId: m.id, orgId: A.orgId } })).toBe(0);
  });

  it("owners de outra org nunca recebem", async () => {
    const m = await mkUser("iso", A.orgId);
    await asOwner();
    await removeMember({ userId: m.id });
    const bOwner = (await prisma.user.findUniqueOrThrow({ where: { id: B.userId } })).email;
    expect(sent.some((e) => e.to === bOwner)).toBe(false);
  });

  it("teto por org/hora (D-056-2): entradas acima do teto nao enviam", async () => {
    const orgC = await createTestOrg("orgn-cap");
    try {
      const m = await mkUser("cap", orgC.orgId);
      const mem = await prisma.membership.findUniqueOrThrow({ where: { userId_orgId: { userId: m.id, orgId: orgC.orgId } } });
      await prisma.orgAuditLog.createMany({ data: Array.from({ length: ORG_JOIN_EMAILS_PER_HOUR }, () => ({ orgId: orgC.orgId, action: "member_joined" })) });
      await notifyOrgMemberEvent({ kind: "joined", orgId: orgC.orgId, memberUserId: m.id, membershipId: mem.id });
      expect(sent).toHaveLength(1); // = teto: ainda envia
      sent.length = 0;
      await prisma.orgAuditLog.create({ data: { orgId: orgC.orgId, action: "member_joined" } });
      await notifyOrgMemberEvent({ kind: "joined", orgId: orgC.orgId, memberUserId: m.id, membershipId: randomUUID() });
      expect(sent).toHaveLength(0);
    } finally {
      await prisma.emailDispatchLog.deleteMany({ where: { orgId: orgC.orgId } });
      await prisma.orgAuditLog.deleteMany({ where: { orgId: orgC.orgId } });
      await prisma.membership.deleteMany({ where: { orgId: orgC.orgId } });
      await purgeTestOrg(orgC);
    }
  });

  it("notifyOrgMemberEvent nunca lanca (org inexistente)", async () => {
    await expect(notifyOrgMemberEvent({ kind: "left", orgId: randomUUID(), memberUserId: randomUUID(), membershipId: "x" })).resolves.toBeUndefined();
  });
});
