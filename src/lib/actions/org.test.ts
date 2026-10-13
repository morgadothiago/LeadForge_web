import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sent: { to: string; subject: string; html: string; text: string; scenario: string }[] = [];
vi.mock("@/lib/channels/system-mail", () => ({
  sendSystemEmail: vi.fn(async (to: string, subject: string, content: { html: string; text: string }, scenario: string) => {
    sent.push({ to, subject, html: content.html, text: content.text, scenario });
    return { ok: true, messageId: "m1" };
  }),
}));

import { prisma } from "@/lib/prisma";
import { grantAllEntitlements } from "@/lib/test-utils/trial-fixture";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { getCookie, runWithSession, signInAs, signOut } from "@/lib/auth/test-helpers";
import { SESSION_COOKIE } from "@/lib/auth/config";
import { verifySessionToken } from "@/lib/auth/session-token";
import { requireUser, UnauthorizedError } from "@/lib/auth/require-user";
import { lockOrg } from "@/lib/org/guards";
import { clearOrgRateLimits } from "@/lib/org/rate-limit";
import { hashInviteToken, normalizeJoinCode } from "@/lib/org/tokens";
import { backfillLastOrgId } from "@/lib/org/backfill";
import { login } from "./auth";
import {
  acceptInvite,
  changeMemberRole,
  disableJoinCode,
  generateJoinCode,
  inviteMember,
  joinByCode,
  leaveOrganization,
  listMembers,
  listMyOrganizations,
  previewInvite,
  removeMember,
  revokeInvite,
  signUpAndJoin,
  switchActiveOrganization,
} from "./org";

let A: TestOrg; // owner uA
let B: TestOrg; // owner uB
const extraUsers: string[] = [];
const createdOrgs: string[] = [];
const createdEmails: string[] = [];

async function mkUser(tag: string, opts: { orgId?: string; role?: "owner" | "member"; password?: string } = {}) {
  const id = randomUUID();
  const email = `zz-org-${tag}-${id.slice(0, 8)}@test.local`;
  const { hashPassword } = await import("@/lib/auth/password");
  await prisma.user.create({ data: { id, name: `zz ${tag}`, email, role: "provider", passwordHash: opts.password ? await hashPassword(opts.password) : null } });
  extraUsers.push(id);
  if (opts.orgId) await prisma.membership.create({ data: { userId: id, orgId: opts.orgId, orgRole: opts.role ?? "member" } });
  return { id, email };
}
const err = (r: { ok: boolean; errors?: Record<string, string[]> }) => (r.ok ? "" : Object.values(r.errors ?? {}).flat().join(" | "));
async function sessionOrg() {
  return (await verifySessionToken(getCookie(SESSION_COOKIE)))?.orgId;
}
function tokenFromLastEmail(): string {
  const m = sent[sent.length - 1].text.match(/\/convite\/([A-Za-z0-9_-]+)/);
  return m![1];
}

beforeAll(async () => {
  A = await createTestOrg("org49-a");
  B = await createTestOrg("org49-b");
  await prisma.subscription.create({ data: { orgId: A.orgId, planId: (await prisma.plan.findUniqueOrThrow({ where: { key: "starter" } })).id, status: "active", cadence: "monthly" } });
  await grantAllEntitlements(A.orgId); // SPEC-069b: o Starter limita membros (3); este arquivo testa o fluxo de equipe, nao o limite
});
beforeEach(() => {
  clearOrgRateLimits();
  sent.length = 0;
});
afterEach(() => signOut());
afterAll(async () => {
  await prisma.orgInvite.deleteMany({ where: { orgId: { in: [A.orgId, B.orgId, ...createdOrgs] } } });
  await prisma.orgAuditLog.deleteMany({ where: { orgId: { in: [A.orgId, B.orgId, ...createdOrgs] } } });
  await prisma.subscription.deleteMany({ where: { orgId: { in: [A.orgId, B.orgId, ...createdOrgs] } } });
  await prisma.membership.deleteMany({ where: { orgId: { in: createdOrgs } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgs } } });
  await prisma.user.deleteMany({ where: { OR: [{ id: { in: extraUsers } }, { email: { in: createdEmails } }] } });
  await purgeTestOrg(A);
  await purgeTestOrg(B);
});

describe("convite nominal: inviteMember / previewInvite / acceptInvite / revokeInvite", () => {
  it("member não convida; owner convida; token só em hash; e-mail org_invite enviado", async () => {
    const m = await mkUser("m1", { orgId: A.orgId, role: "member" });
    await signInAs(m.id, { orgId: A.orgId, platformRole: "provider" });
    expect(err(await inviteMember({ email: "x@test.local" }))).toMatch(/Sem permissão/);

    const guest = await mkUser("guest");
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    const r = await inviteMember({ email: guest.email.toUpperCase(), orgRole: "member" });
    expect(r.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].scenario).toBe("org_invite");
    expect(sent[0].to).toBe(guest.email);
    const token = tokenFromLastEmail();
    const row = await prisma.orgInvite.findFirstOrThrow({ where: { orgId: A.orgId, email: guest.email } });
    expect(row.tokenHash).toBe(hashInviteToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    const audit = await prisma.orgAuditLog.findMany({ where: { orgId: A.orgId, action: "member_invited" } });
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it("aceite: e-mail igual (case-insensitive) entra; uso único; token reutilizado falha; sessão vai para a org nova", async () => {
    const guest = await mkUser("acc");
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    await inviteMember({ email: guest.email });
    const token = tokenFromLastEmail();

    signOut();
    await signInAs(guest.id, { orgId: B.orgId, platformRole: "provider" }); // sem membership em B => sessão inválida
    expect((await acceptInvite({ token })).ok).toBe(false);

    await prisma.membership.create({ data: { userId: guest.id, orgId: B.orgId, orgRole: "member" } });
    const ok = await acceptInvite({ token });
    expect(ok.ok).toBe(true);
    expect(await sessionOrg()).toBe(A.orgId);
    const m = await prisma.membership.findUniqueOrThrow({ where: { userId_orgId: { userId: guest.id, orgId: A.orgId } } });
    expect(m.orgRole).toBe("member");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: guest.id } })).lastOrgId).toBe(A.orgId);
    expect(await prisma.orgAuditLog.count({ where: { orgId: A.orgId, action: "member_joined", targetUserId: guest.id } })).toBe(1);

    const again = await acceptInvite({ token });
    expect(again.ok).toBe(false);
  });

  it("e-mail diferente do convite => erro genérico e convite NÃO é consumido", async () => {
    const guest = await mkUser("wrong");
    const other = await mkUser("other", { orgId: B.orgId });
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    await inviteMember({ email: guest.email });
    const token = tokenFromLastEmail();
    signOut();
    await signInAs(other.id, { orgId: B.orgId, platformRole: "provider" });
    const r = await acceptInvite({ token });
    expect(err(r)).toMatch(/inválido, expirado ou não destinado/);
    expect((await prisma.orgInvite.findUniqueOrThrow({ where: { tokenHash: hashInviteToken(token) } })).usedAt).toBeNull();
    expect(await prisma.membership.count({ where: { userId: other.id, orgId: A.orgId } })).toBe(0);
  });

  it("expirado, revogado e inexistente => mesma mensagem genérica; já-membro não queima o convite", async () => {
    const g1 = await mkUser("exp", { orgId: B.orgId });
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    await inviteMember({ email: g1.email });
    const t1 = tokenFromLastEmail();
    await prisma.orgInvite.updateMany({ where: { tokenHash: hashInviteToken(t1) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    signOut();
    await signInAs(g1.id, { orgId: B.orgId, platformRole: "provider" });
    const expired = err(await acceptInvite({ token: t1 }));
    expect(expired).toMatch(/inválido, expirado/);
    expect(err(await acceptInvite({ token: "nao-existe-123" }))).toBe(expired);

    // revogado
    signOut();
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    await inviteMember({ email: g1.email });
    const t2 = tokenFromLastEmail();
    const inv = await prisma.orgInvite.findUniqueOrThrow({ where: { tokenHash: hashInviteToken(t2) } });
    expect((await revokeInvite({ inviteId: inv.id })).ok).toBe(true);
    signOut();
    await signInAs(g1.id, { orgId: B.orgId, platformRole: "provider" });
    expect(err(await acceptInvite({ token: t2 }))).toBe(expired);

    // já é membro de A: erro específico e convite continua pendente
    await prisma.membership.create({ data: { userId: g1.id, orgId: A.orgId, orgRole: "member" } });
    signOut();
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    await prisma.orgInvite.updateMany({ where: { orgId: A.orgId, email: g1.email }, data: { revokedAt: new Date() } }); // limpa
    const direct = await prisma.orgInvite.create({ data: { orgId: A.orgId, email: g1.email, tokenHash: hashInviteToken("tok-already"), expiresAt: new Date(Date.now() + 60_000) } });
    signOut();
    await signInAs(g1.id, { orgId: B.orgId, platformRole: "provider" });
    expect(err(await acceptInvite({ token: "tok-already" }))).toMatch(/já participa/);
    expect((await prisma.orgInvite.findUniqueOrThrow({ where: { id: direct.id } })).usedAt).toBeNull();
  });

  it("revokeInvite com id de convite de OUTRA org => não encontrado (isolamento)", async () => {
    const inv = await prisma.orgInvite.create({ data: { orgId: B.orgId, email: "alvo@test.local", tokenHash: hashInviteToken("tok-b"), expiresAt: new Date(Date.now() + 60_000) } });
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    expect(err(await revokeInvite({ inviteId: inv.id }))).toMatch(/não encontrado/);
    expect((await prisma.orgInvite.findUniqueOrThrow({ where: { id: inv.id } })).revokedAt).toBeNull();
  });

  it("novo convite para o mesmo e-mail revoga o anterior; convidar quem já é membro é recusado", async () => {
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    await inviteMember({ email: "dup@test.local" });
    const t1 = tokenFromLastEmail();
    await inviteMember({ email: "dup@test.local" });
    expect((await prisma.orgInvite.findUniqueOrThrow({ where: { tokenHash: hashInviteToken(t1) } })).revokedAt).not.toBeNull();
    const self = await prisma.user.findUniqueOrThrow({ where: { id: A.userId } });
    expect(err(await inviteMember({ email: self.email }))).toMatch(/já participa/);
  });

  it("previewInvite: válido devolve org/e-mail/userExists; inválido => valid:false sem detalhe", async () => {
    const g = await mkUser("prev");
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    await inviteMember({ email: g.email });
    signOut();
    const r = await previewInvite({ token: tokenFromLastEmail() });
    expect(r.ok && r.data.valid && r.data.userExists && r.data.email === g.email).toBe(true);
    const bad = await previewInvite({ token: "xxxxxxxx" });
    expect(bad.ok && bad.data.valid === false).toBe(true);
  });

  it("rate limit: força bruta de tokens é bloqueada após o teto por usuário", async () => {
    const u = await mkUser("brute", { orgId: B.orgId });
    await signInAs(u.id, { orgId: B.orgId, platformRole: "provider" });
    let last = "";
    for (let i = 0; i < 12; i++) last = err(await acceptInvite({ token: `chute-${i}` }));
    expect(last).toMatch(/Muitas tentativas/);
  });

  it("rate limit de convites por org/usuário", async () => {
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    let last = "";
    for (let i = 0; i < 21; i++) last = err(await inviteMember({ email: `spam${i}@test.local` }));
    expect(last).toMatch(/Muitas tentativas/);
  });
});

describe("código reutilizável: generateJoinCode / joinByCode / disableJoinCode", () => {
  it("member não gera; owner gera (expiração + limite sempre definidos); entrada cria member e consome 1 uso", async () => {
    const m = await mkUser("cm", { orgId: A.orgId, role: "member" });
    await signInAs(m.id, { orgId: A.orgId, platformRole: "provider" });
    expect(err(await generateJoinCode())).toMatch(/Sem permissão/);

    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    const g = await generateJoinCode({ expiresInDays: 2, maxUses: 2 });
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(normalizeJoinCode(g.data.code)).toHaveLength(20);

    const u = await mkUser("c1", { orgId: B.orgId });
    signOut();
    await signInAs(u.id, { orgId: B.orgId, platformRole: "provider" });
    expect((await joinByCode({ code: g.data.code.toLowerCase() })).ok).toBe(true);
    expect(await sessionOrg()).toBe(A.orgId);
    expect((await prisma.membership.findUniqueOrThrow({ where: { userId_orgId: { userId: u.id, orgId: A.orgId } } })).orgRole).toBe("member");
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: A.orgId } })).joinCodeUses).toBe(1);
    // já membro: erro e uso NÃO consumido
    expect(err(await joinByCode({ code: g.data.code }))).toMatch(/já participa/);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: A.orgId } })).joinCodeUses).toBe(1);
  });

  it("limite de usos esgotado, expirado, desativado e inexistente => mensagem genérica", async () => {
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    const g = await generateJoinCode({ maxUses: 1 });
    if (!g.ok) throw new Error("gen");
    const u1 = await mkUser("l1", { orgId: B.orgId });
    const u2 = await mkUser("l2", { orgId: B.orgId });
    signOut();
    await signInAs(u1.id, { orgId: B.orgId, platformRole: "provider" });
    expect((await joinByCode({ code: g.data.code })).ok).toBe(true);
    signOut();
    await signInAs(u2.id, { orgId: B.orgId, platformRole: "provider" });
    const exhausted = err(await joinByCode({ code: g.data.code }));
    expect(exhausted).toMatch(/Código inválido ou expirado/);
    expect(err(await joinByCode({ code: "ZZZZZZZZZZZZZZZZZZZZ" }))).toBe(exhausted);

    signOut();
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    const g2 = await generateJoinCode({ maxUses: 5 });
    if (!g2.ok) throw new Error("gen2");
    await prisma.organization.update({ where: { id: A.orgId }, data: { joinCodeExpiresAt: new Date(Date.now() - 1000) } });
    signOut();
    await signInAs(u2.id, { orgId: B.orgId, platformRole: "provider" });
    expect(err(await joinByCode({ code: g2.data.code }))).toBe(exhausted);

    signOut();
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    const g3 = await generateJoinCode({});
    if (!g3.ok) throw new Error("gen3");
    expect((await disableJoinCode()).ok).toBe(true);
    signOut();
    await signInAs(u2.id, { orgId: B.orgId, platformRole: "provider" });
    expect(err(await joinByCode({ code: g3.data.code }))).toBe(exhausted);
  });

  it("concorrência: 5 entradas simultâneas com maxUses=2 => no máximo 2 sucessos", async () => {
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    const g = await generateJoinCode({ maxUses: 2 });
    if (!g.ok) throw new Error("gen");
    const { joinWithCode } = await import("@/lib/org/join");
    const users = await Promise.all([1, 2, 3, 4, 5].map((i) => mkUser(`race${i}`)));
    const results = await Promise.allSettled(
      users.map((u) => prisma.$transaction((tx) => joinWithCode(tx, { code: normalizeJoinCode(g.data.code), userId: u.id, now: new Date(), via: "code" }))),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: A.orgId } })).joinCodeUses).toBe(2);
  });

  it("listMembers: owner vê convites pendentes e o código; member não", async () => {
    const m = await mkUser("lm", { orgId: A.orgId, role: "member" });
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    await generateJoinCode({});
    await inviteMember({ email: "pend@test.local" });
    const o = await listMembers();
    expect(o.ok && o.data.invites.some((i) => i.email === "pend@test.local") && o.data.joinCode?.code.includes("-")).toBe(true);
    signOut();
    await signInAs(m.id, { orgId: A.orgId, platformRole: "provider" });
    const r = await listMembers();
    expect(r.ok && r.data.invites.length === 0 && r.data.joinCode === null && r.data.members.length >= 2).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/passwordHash/);
  });
});

describe("papéis: changeMemberRole / removeMember / leaveOrganization (nunca sem owner)", () => {
  it("último owner não pode ser rebaixado nem sair; com 2 owners pode; member não altera papéis", async () => {
    const org = await createTestOrg("org49-roles");
    const o2 = await mkUser("o2", { orgId: org.orgId, role: "member" });
    // o2 precisa de outra org para poder sair depois
    await prisma.membership.create({ data: { userId: o2.id, orgId: B.orgId, orgRole: "member" } });
    try {
      await signInAs(o2.id, { orgId: org.orgId, platformRole: "provider" });
      expect(err(await changeMemberRole({ userId: org.userId, orgRole: "member" }))).toMatch(/Sem permissão/);
      expect(err(await removeMember({ userId: org.userId }))).toMatch(/Sem permissão/);

      signOut();
      await signInAs(org.userId, { orgId: org.orgId, platformRole: "provider" });
      expect(err(await changeMemberRole({ userId: org.userId, orgRole: "member" }))).toMatch(/ao menos um owner/);
      // sozinho como owner e ÚNICA org: sair bloqueado (por qualquer um dos motivos)
      expect((await leaveOrganization()).ok).toBe(false);
      // promove o2 -> 2 owners
      expect((await changeMemberRole({ userId: o2.id, orgRole: "owner" })).ok).toBe(true);
      expect(await prisma.orgAuditLog.count({ where: { orgId: org.orgId, action: "role_changed" } })).toBe(1);
      // owner original rebaixa a si mesmo (há outro owner)
      expect((await changeMemberRole({ userId: org.userId, orgRole: "member" })).ok).toBe(true);
      // agora ele é member e não pode mais gerir
      expect(err(await changeMemberRole({ userId: o2.id, orgRole: "member" }))).toMatch(/Sem permissão/);
      // o2 é o último owner: não pode se rebaixar
      signOut();
      await signInAs(o2.id, { orgId: org.orgId, platformRole: "provider" });
      expect(err(await changeMemberRole({ userId: o2.id, orgRole: "member" }))).toMatch(/ao menos um owner/);
      expect(err(await leaveOrganization())).toMatch(/ao menos um owner/);
      expect(await prisma.membership.count({ where: { orgId: org.orgId, orgRole: "owner" } })).toBe(1);
    } finally {
      await prisma.membership.deleteMany({ where: { userId: o2.id, orgId: B.orgId } });
      await prisma.orgAuditLog.deleteMany({ where: { orgId: org.orgId } });
      await purgeTestOrg(org);
    }
  });

  describe("concorrência REAL das actions (2 owners, sessões distintas; D-049-12)", () => {
    // Segura o lock da org enquanto as duas actions passam por requireOrgOwner (papel "velho") e bloqueiam em lockOrg;
    // ao liberar, as duas rodam serializadas — a segunda precisa reconfirmar o papel do ator sob o lock.
    async function race(label: string, mk: (o1: string, o2: string, orgId: string) => [() => Promise<{ ok: boolean }>, () => Promise<{ ok: boolean }>]) {
      const org = await createTestOrg(`org49-race-${label}`);
      const o2 = await mkUser(`race-${label}`, { orgId: org.orgId, role: "owner" });
      try {
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        let locked!: () => void;
        const hasLock = new Promise<void>((r) => (locked = r));
        const holder = prisma.$transaction(async (tx) => {
          await lockOrg(tx, org.orgId);
          locked();
          await gate;
        });
        await hasLock;
        const [a, b] = mk(org.userId, o2.id, org.orgId);
        const both = Promise.all([a(), b()]);
        await new Promise((r) => setTimeout(r, 700)); // ambas já passaram pelo pré-check e esperam o lock
        release();
        await holder;
        const rs = await both;
        expect(rs.filter((r) => r.ok)).toHaveLength(1);
        expect(await prisma.membership.count({ where: { orgId: org.orgId, orgRole: "owner" } })).toBe(1);
      } finally {
        await prisma.orgAuditLog.deleteMany({ where: { orgId: org.orgId } });
        await purgeTestOrg(org);
      }
    }

    it("remover x remover: A remove B e B remove A => sobra 1 owner", async () => {
      await race("rr", (o1, o2, orgId) => [
        () => runWithSession(o1, orgId, () => removeMember({ userId: o2 })),
        () => runWithSession(o2, orgId, () => removeMember({ userId: o1 })),
      ]);
    });
    it("rebaixar x remover: A rebaixa B e B remove A => sobra 1 owner", async () => {
      await race("dr", (o1, o2, orgId) => [
        () => runWithSession(o1, orgId, () => changeMemberRole({ userId: o2, orgRole: "member" })),
        () => runWithSession(o2, orgId, () => removeMember({ userId: o1 })),
      ]);
    });
    it("rebaixar x rebaixar: A rebaixa B e B rebaixa A => sobra 1 owner", async () => {
      await race("dd", (o1, o2, orgId) => [
        () => runWithSession(o1, orgId, () => changeMemberRole({ userId: o2, orgRole: "member" })),
        () => runWithSession(o2, orgId, () => changeMemberRole({ userId: o1, orgRole: "member" })),
      ]);
    });
  });

  it("owner removido/rebaixado: convites pendentes que ele criou são revogados e o código que ele gerou é desativado (D-049-13)", async () => {
    const org = await createTestOrg("org49-revoke");
    const o2 = await mkUser("rv-o2", { orgId: org.orgId, role: "owner" });
    try {
      // o2 cria convite + código; o1 também cria um convite
      await signInAs(o2.id, { orgId: org.orgId, platformRole: "provider" });
      await inviteMember({ email: "rv-o2-inv@test.local" });
      const g = await generateJoinCode({ maxUses: 5 });
      if (!g.ok) throw new Error("gen");
      signOut();
      await signInAs(org.userId, { orgId: org.orgId, platformRole: "provider" });
      await inviteMember({ email: "rv-o1-inv@test.local" });
      // rebaixa o2
      expect((await changeMemberRole({ userId: o2.id, orgRole: "member" })).ok).toBe(true);
      const pending = await prisma.orgInvite.findMany({ where: { orgId: org.orgId, revokedAt: null, usedAt: null } });
      expect(pending.map((i) => i.email)).toEqual(["rv-o1-inv@test.local"]);
      const o = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
      expect(o.joinCode).toBeNull();
      // código gerado por quem permanece owner continua valendo ao remover um member
      const g2 = await generateJoinCode({ maxUses: 5 });
      expect(g2.ok).toBe(true);
      expect((await removeMember({ userId: o2.id })).ok).toBe(true);
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } })).joinCode).not.toBeNull();
      expect(await prisma.orgInvite.count({ where: { orgId: org.orgId, revokedAt: null, usedAt: null } })).toBe(1);
    } finally {
      await prisma.orgInvite.deleteMany({ where: { orgId: org.orgId } });
      await prisma.orgAuditLog.deleteMany({ where: { orgId: org.orgId } });
      await purgeTestOrg(org);
    }
  });

  it("removeMember: owner remove outro; sessão do removido deixa de valer na org (requireUser); auto-remoção orienta 'Sair'", async () => {
    const m = await mkUser("rm", { orgId: A.orgId, role: "member" });
    await prisma.membership.create({ data: { userId: m.id, orgId: B.orgId, orgRole: "member" } });
    await prisma.user.update({ where: { id: m.id }, data: { lastOrgId: A.orgId } });
    await signInAs(m.id, { orgId: A.orgId, platformRole: "provider" });
    expect((await requireUser()).orgId).toBe(A.orgId);

    signOut();
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    expect(err(await removeMember({ userId: A.userId }))).toMatch(/Sair/);
    expect((await removeMember({ userId: m.id })).ok).toBe(true);
    expect(err(await removeMember({ userId: m.id }))).toMatch(/não encontrado/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: m.id } })).lastOrgId).toBeNull();
    expect(await prisma.orgAuditLog.count({ where: { orgId: A.orgId, action: "member_removed", targetUserId: m.id } })).toBe(1);

    // JWT antigo do removido continua assinado, mas requireUser o rejeita
    signOut();
    await signInAs(m.id, { orgId: A.orgId, platformRole: "provider" });
    await expect(requireUser()).rejects.toBeInstanceOf(UnauthorizedError);
    // ...mas a sessão dele na OUTRA org (B) segue válida
    signOut();
    await signInAs(m.id, { orgId: B.orgId, platformRole: "provider" });
    expect((await requireUser()).orgId).toBe(B.orgId);
  });

  it("removeMember/changeMemberRole só atuam na org da sessão (userId de outra org => não encontrado)", async () => {
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    expect(err(await removeMember({ userId: B.userId }))).toMatch(/não encontrado/);
    expect(err(await changeMemberRole({ userId: B.userId, orgRole: "member" }))).toMatch(/não encontrado/);
    expect(await prisma.membership.count({ where: { userId: B.userId, orgId: B.orgId } })).toBe(1);
  });

  it("leaveOrganization: member com 2+ orgs sai e a sessão vai para outra org; com 1 org só, bloqueado", async () => {
    const m = await mkUser("lv", { orgId: A.orgId, role: "member" });
    await signInAs(m.id, { orgId: A.orgId, platformRole: "provider" });
    expect(err(await leaveOrganization())).toMatch(/única organização/);
    await prisma.membership.create({ data: { userId: m.id, orgId: B.orgId, orgRole: "member" } });
    const r = await leaveOrganization();
    expect(r.ok).toBe(true);
    expect(await sessionOrg()).toBe(B.orgId);
    expect(await prisma.membership.count({ where: { userId: m.id, orgId: A.orgId } })).toBe(0);
    expect(await prisma.orgAuditLog.count({ where: { orgId: A.orgId, action: "member_left", targetUserId: m.id } })).toBe(1);
  });
});

describe("org ativa: listMyOrganizations / switchActiveOrganization / login", () => {
  it("switch reemite o JWT, grava lastOrgId e recusa org onde não é membro (mesma resposta p/ inexistente)", async () => {
    const u = await mkUser("sw", { orgId: A.orgId, role: "member" });
    await prisma.membership.create({ data: { userId: u.id, orgId: B.orgId, orgRole: "owner" } });
    await signInAs(u.id, { orgId: A.orgId, platformRole: "provider" });
    const list = await listMyOrganizations();
    expect(list.ok && list.data.organizations.length === 2 && list.data.activeOrgId === A.orgId).toBe(true);

    expect((await switchActiveOrganization({ orgId: B.orgId })).ok).toBe(true);
    expect(await sessionOrg()).toBe(B.orgId);
    expect((await requireUser()).orgId).toBe(B.orgId);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).lastOrgId).toBe(B.orgId);

    const org3 = await createTestOrg("org49-sw3");
    try {
      const denied = err(await switchActiveOrganization({ orgId: org3.orgId }));
      const ghost = err(await switchActiveOrganization({ orgId: randomUUID() }));
      expect(denied).toBe(ghost);
      expect(await sessionOrg()).toBe(B.orgId);
    } finally {
      await purgeTestOrg(org3);
    }
  });

  it("org suspensa não impede trocar para outra org ativa", async () => {
    const susp = await createTestOrg("org49-susp");
    const u = await mkUser("susp", { orgId: susp.orgId, role: "owner" });
    await prisma.membership.create({ data: { userId: u.id, orgId: A.orgId, orgRole: "member" } });
    await prisma.organization.update({ where: { id: susp.orgId }, data: { status: "suspended" } });
    try {
      await signInAs(u.id, { orgId: susp.orgId, platformRole: "provider" });
      expect((await switchActiveOrganization({ orgId: A.orgId })).ok).toBe(true);
      expect(await sessionOrg()).toBe(A.orgId);
    } finally {
      await purgeTestOrg(susp);
    }
  });

  it("platform_admin e sem sessão não trocam/listam", async () => {
    expect(err(await switchActiveOrganization({ orgId: A.orgId }))).toMatch(/Sessão expirada/);
    await signInAs(A.userId, { orgId: null, platformRole: "platform_admin" });
    expect(err(await switchActiveOrganization({ orgId: A.orgId }))).toMatch(/Sem permissão/);
    expect(err(await inviteMember({ email: "a@b.co" }))).toMatch(/Sem permissão/);
  });

  it("login abre lastOrgId (se ainda membro), senão a primeira org; backfill idempotente", async () => {
    const u = await mkUser("lg", { password: "senha-de-teste-123" });
    await prisma.membership.create({ data: { userId: u.id, orgId: A.orgId, orgRole: "member", createdAt: new Date(Date.now() - 5000) } });
    await prisma.membership.create({ data: { userId: u.id, orgId: B.orgId, orgRole: "member" } });
    // backfill: preenche só quem tem null, com a org mais antiga; segunda execução é no-op
    const first = await backfillLastOrgId();
    expect(first.updated).toBeGreaterThanOrEqual(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).lastOrgId).toBe(A.orgId);
    expect((await backfillLastOrgId()).updated).toBe(0);

    await prisma.user.update({ where: { id: u.id }, data: { lastOrgId: B.orgId } });
    expect((await login({ email: u.email, password: "senha-de-teste-123" })).ok).toBe(true);
    expect(await sessionOrg()).toBe(B.orgId);

    signOut();
    await prisma.user.update({ where: { id: u.id }, data: { lastOrgId: randomUUID() } }); // org inexistente/sem membership
    expect((await login({ email: u.email, password: "senha-de-teste-123" })).ok).toBe(true);
    expect(await sessionOrg()).toBe(A.orgId);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).lastOrgId).toBe(A.orgId);
  });
});

describe("signUpAndJoin (sem checkout)", () => {
  it("convite: cria conta com o e-mail do convite, entra como o papel convidado, sem Subscription nova", async () => {
    const email = `zz-signup-inv-${randomUUID().slice(0, 8)}@test.local`;
    createdEmails.push(email);
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    await inviteMember({ email, orgRole: "member" });
    const token = tokenFromLastEmail();
    signOut();
    const r = await signUpAndJoin({ name: "Novo", password: "uma-senha-bem-longa-1", confirmPassword: "uma-senha-bem-longa-1", token });
    expect(r.ok).toBe(true);
    expect(await sessionOrg()).toBe(A.orgId);
    const u = await prisma.user.findUniqueOrThrow({ where: { email }, include: { memberships: true } });
    expect(u.memberships).toHaveLength(1);
    expect(u.memberships[0].orgId).toBe(A.orgId);
    expect(u.lastOrgId).toBe(A.orgId);
    expect(await prisma.organization.count({ where: { memberships: { some: { userId: u.id } } } })).toBe(1);
    // reutilizar o token falha
    signOut();
    expect(err(await signUpAndJoin({ name: "Outro", password: "uma-senha-bem-longa-1", confirmPassword: "uma-senha-bem-longa-1", token }))).toMatch(/inválido/);
  });

  it("convite para e-mail já cadastrado: orienta login/aceite", async () => {
    const g = await mkUser("signup-exists");
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    await inviteMember({ email: g.email });
    signOut();
    expect(err(await signUpAndJoin({ name: "X", password: "uma-senha-bem-longa-1", confirmPassword: "uma-senha-bem-longa-1", token: tokenFromLastEmail() }))).toMatch(/já possui cadastro/);
  });

  it("SPEC-062 (D-062-15): o ramo por CODIGO saiu do signUpAndJoin — com `code` (sem token) e recusado, sem criar usuario nem consumir uso", async () => {
    await signInAs(A.userId, { orgId: A.orgId, platformRole: "provider" });
    const g = await generateJoinCode({ maxUses: 5 });
    if (!g.ok) throw new Error("gen");
    signOut();
    const email = `zz-signup-code-${randomUUID().slice(0, 8)}@test.local`;
    const uses = (await prisma.organization.findUniqueOrThrow({ where: { id: A.orgId } })).joinCodeUses;
    expect((await signUpAndJoin({ name: "C", email, password: "uma-senha-bem-longa-1", confirmPassword: "uma-senha-bem-longa-1", code: g.data.code })).ok).toBe(false);
    expect((await signUpAndJoin({ name: "C", email, password: "uma-senha-bem-longa-1", confirmPassword: "uma-senha-bem-longa-1" })).ok).toBe(false);
    expect(await prisma.user.count({ where: { email } })).toBe(0);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: A.orgId } })).joinCodeUses).toBe(uses);
  });
});
