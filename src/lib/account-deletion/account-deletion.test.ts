import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { getCookie, setCookie, signInAs, signOut } from "@/lib/auth/test-helpers";
import { hashPassword } from "@/lib/auth/password";
import { requireUser, UnauthorizedError } from "@/lib/auth/require-user";
import { sendSystemEmail } from "@/lib/channels/system-mail";
import { login } from "@/lib/actions/auth";
import { POST as mobileLogin } from "@/app/api/mobile/v1/auth/login/route";
import {
  cancelAccountDeletion,
  cancelAccountDeletionByToken,
  cancelAccountDeletionWithPassword,
  confirmAccountDeletion,
  getAccountDeletionState,
  previewAccountDeletionToken,
  requestAccountDeletion,
} from "@/lib/actions/account-deletion";
import { clearAccountDeletionRateLimit } from "./service";
import { executeAccountDeletion, purgeRetainedUserLogs, runAccountDeletionJob, _clearBlockedLog } from "./purge";
import { ANONYMIZED_NAME, DELETION_WINDOW_DAYS, DELETION_WINDOW_MS, anonymizedEmail, hashDeletionToken } from "./constants";
import { ANONYMIZED_ITEMS, DELETED_ITEMS, RETAINED_ITEMS } from "./retention";
import { accountDeletedTemplate } from "@/lib/channels/email/templates/account-deleted";
import { purgeCanceledOrgs } from "@/lib/billing/purge";
import { CANCEL_RETENTION_MS } from "@/lib/billing/status-map";

/** SPEC-054a — exclusao de conta (LGPD). `sendSystemEmail` mockado (nunca provedor real). */
vi.mock("@/lib/channels/system-mail", () => ({ sendSystemEmail: vi.fn(async () => ({ ok: true, messageId: "" })) }));

const PASS = "Senha-Forte-12345";
const DAY = 24 * 3600_000;
let passHash: string;
let seq = 0;
const created: { users: string[]; orgs: TestOrg[]; tag: string } = { users: [], orgs: [], tag: "" };

beforeAll(async () => {
  passHash = await hashPassword(PASS);
});
beforeEach(() => {
  clearAccountDeletionRateLimit();
  _clearBlockedLog();
  vi.mocked(sendSystemEmail).mockReset();
  vi.mocked(sendSystemEmail).mockResolvedValue({ ok: true, messageId: "" });
  created.users = [];
  created.orgs = [];
});
afterEach(async () => {
  signOut();
  vi.restoreAllMocks();
  const ids = [...created.users, ...created.orgs.map((o) => o.userId)];
  await prisma.accountDeletionRequest.deleteMany({ where: { userId: { in: ids } } });
  await prisma.emailDispatchLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { scenario: { startsWith: "account_deleted" } }] } });
  await prisma.integrationAuditLog.deleteMany({ where: { orgId: { in: created.orgs.map((o) => o.orgId) } } });
  for (const o of created.orgs) {
    await prisma.subscription.deleteMany({ where: { orgId: o.orgId } });
    await prisma.orgInvite.deleteMany({ where: { orgId: o.orgId } });
    await prisma.orgAuditLog.deleteMany({ where: { orgId: o.orgId } });
    await prisma.webhookEvent.deleteMany({ where: { orgId: o.orgId } });
    await prisma.emailAccount.deleteMany({ where: { orgId: o.orgId } });
    await prisma.mobileDevice.deleteMany({ where: { userId: { in: ids } } });
    await prisma.membership.deleteMany({ where: { orgId: o.orgId } });
    await purgeTestOrg(o);
  }
  await prisma.mobileDevice.deleteMany({ where: { userId: { in: ids } } });
  await prisma.mobileActionLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});

async function mkOrg(tag: string): Promise<TestOrg> {
  const o = await createTestOrg(`${tag}${++seq}`);
  created.orgs.push(o);
  return o;
}
/** Usuario com senha (opcional) e membership. */
async function mkUser(role: "owner" | "member", org: TestOrg | null, withPassword = true): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `zz-del-${id.slice(0, 8)}@test.local`;
  await prisma.user.create({ data: { id, name: "zz del", email, role: "provider", passwordHash: withPassword ? passHash : null } });
  created.users.push(id);
  if (org) await prisma.membership.create({ data: { userId: id, orgId: org.orgId, orgRole: role } });
  return { id, email };
}
/** O dono da org de teste ganha senha (o fixture nao cria). */
async function givePassword(org: TestOrg): Promise<{ id: string; email: string }> {
  const u = await prisma.user.update({ where: { id: org.userId }, data: { passwordHash: passHash }, select: { id: true, email: true } });
  return u;
}
const planId = async () => (await prisma.plan.findUniqueOrThrow({ where: { key: "starter" }, select: { id: true } })).id;
async function mkSub(orgId: string, over: Record<string, unknown> = {}) {
  return prisma.subscription.create({ data: { orgId, planId: await planId(), status: "canceled", canceledAt: new Date(), ...over } as never });
}

const mails = () => vi.mocked(sendSystemEmail).mock.calls.map((c) => ({ to: c[0], subject: c[1], html: c[2].html, text: c[2].text, scenario: c[3] }));
const mailsOf = (scenario: string) => mails().filter((m) => m.scenario === scenario);
const tokenFrom = (scenario: string, re: RegExp): string => {
  const m = mailsOf(scenario).at(-1)!.text.match(re);
  return m![1];
};
const confirmToken = () => tokenFrom("account_deletion_confirm", /\/conta\/excluir\/([\w-]+)/);
const cancelToken = () => tokenFrom("account_deletion_requested", /\/conta\/excluir\/cancelar\/([\w-]+)/);
const asUser = (u: { id: string }, org: TestOrg) => signInAs(u.id, { orgId: org.orgId, platformRole: "provider" });

/** Fluxo completo: pede, confirma e devolve ids. */
async function requestAndConfirm(u: { id: string }, org: TestOrg) {
  await asUser(u, org);
  const r = await requestAccountDeletion({ password: PASS });
  expect(r.ok).toBe(true);
  const c = await confirmAccountDeletion({ token: confirmToken() });
  expect(c.ok).toBe(true);
  const req = await prisma.accountDeletionRequest.findFirstOrThrow({ where: { userId: u.id } });
  return req;
}

describe("pedido: reautenticacao, token e e-mail de confirmacao", () => {
  it("sem sessao e recusado; senha errada nao cria pedido; senha ausente bloqueia", async () => {
    const org = await mkOrg("req");
    const u = await givePassword(org);
    expect((await requestAccountDeletion({ password: PASS })).ok).toBe(false); // sem sessao
    await asUser(u, org);
    const bad = await requestAccountDeletion({ password: "errada-errada" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.password?.[0]).toMatch(/Senha incorreta/);
    expect(await prisma.accountDeletionRequest.count({ where: { userId: u.id } })).toBe(0);
    expect(mails()).toEqual([]);
    const org2 = await mkOrg("nopw");
    await asUser({ id: org2.userId }, org2); // fixture sem senha
    const nopw = await requestAccountDeletion({ password: "qualquer-coisa" });
    expect(nopw.ok).toBe(false);
    if (!nopw.ok) expect(nopw.errors.blockers).toContain("no_password");
  });

  it("senha certa: grava so HASHES (token e e-mail), envia link absoluto uma vez e nunca loga token/e-mail", async () => {
    const org = await mkOrg("ok");
    const u = await givePassword(org);
    const spies = [vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "log"), vi.spyOn(console, "info")];
    await asUser(u, org);
    const r = await requestAccountDeletion({ password: PASS });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.emailSent).toBe(true);
    const sent = mailsOf("account_deletion_confirm");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(u.email);
    const token = confirmToken();
    expect(sent[0].text).toContain(`/conta/excluir/${token}`);
    expect(sent[0].text).toMatch(/https?:\/\//);
    const row = await prisma.accountDeletionRequest.findFirstOrThrow({ where: { userId: u.id } });
    expect(row.tokenHash).toBe(hashDeletionToken(token));
    expect(row.emailHash).toBe(createHash("sha256").update(u.email).digest("hex"));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(JSON.stringify(row)).not.toContain(u.email);
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(row.confirmedAt).toBeNull();
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain(token);
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain(u.email);
  });

  it("novo pedido substitui o pendente (so 1 link valido); expirado e desconhecido sao invalidos", async () => {
    const org = await mkOrg("sup");
    const u = await givePassword(org);
    await asUser(u, org);
    await requestAccountDeletion({ password: PASS });
    const t1 = confirmToken();
    await requestAccountDeletion({ password: PASS });
    const t2 = confirmToken();
    expect(t1).not.toBe(t2);
    const old = await confirmAccountDeletion({ token: t1 });
    expect(old.ok).toBe(false);
    // expirado
    await prisma.accountDeletionRequest.updateMany({ where: { userId: u.id, cancelledAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const exp = await confirmAccountDeletion({ token: t2 });
    expect(exp.ok).toBe(false);
    if (!exp.ok) expect(exp.errors.code).toEqual(["token_invalid"]);
    expect((await confirmAccountDeletion({ token: "nao-existe" })).ok).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).sessionsInvalidatedAt).toBeNull();
  });

  it("rate limit de pedidos por usuario", async () => {
    const org = await mkOrg("rl");
    const u = await givePassword(org);
    await asUser(u, org);
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await requestAccountDeletion({ password: PASS }));
    expect(results.slice(0, 3).every((r) => r.ok)).toBe(true);
    expect(results[3].ok).toBe(false);
  });
});

describe("confirmacao: janela, bloqueio de conta e e-mail #13", () => {
  it("token de uso unico; agenda +30 dias; invalida sessao e dispositivos mobile; envia #13 uma vez com link de cancelamento", async () => {
    const org = await mkOrg("conf");
    const u = await givePassword(org);
    await mkSub(org.orgId); // assinatura ja cancelada: nao bloqueia
    await prisma.mobileDevice.create({ data: { userId: u.id, name: "d", platform: "ios", refreshHash: randomUUID(), refreshExpiresAt: new Date(Date.now() + 1e9) } });
    await asUser(u, org);
    await expect(requireUser()).resolves.toBeTruthy();
    await new Promise((r) => setTimeout(r, 1100)); // iat do JWT tem granularidade de 1s
    await requestAccountDeletion({ password: PASS });
    const oldSession = getCookie("lf_session")!;
    const token = confirmToken();
    const before = Date.now();
    const c = await confirmAccountDeletion({ token });
    expect(c.ok).toBe(true);
    if (c.ok) {
      expect(c.data.windowDays).toBe(30);
      expect(Math.abs(c.data.scheduledFor.getTime() - (before + DELETION_WINDOW_MS))).toBeLessThan(5000);
    }
    // reuso
    const again = await confirmAccountDeletion({ token });
    expect(again.ok).toBe(false);
    // a propria confirmacao encerrou o cookie deste navegador; a sessao ANTIGA (outro navegador) tambem cai
    expect(getCookie("lf_session")).toBeUndefined();
    setCookie("lf_session", oldSession);
    await expect(requireUser()).rejects.toBeInstanceOf(UnauthorizedError);
    const dev = await prisma.mobileDevice.findFirstOrThrow({ where: { userId: u.id } });
    expect(dev.revokedAt).not.toBeNull();
    const rq = mailsOf("account_deletion_requested");
    expect(rq).toHaveLength(1);
    expect(rq[0].to).toBe(u.email);
    expect(rq[0].text).toMatch(/https?:\/\/.+\/conta\/excluir\/cancelar\//);
    const row = await prisma.accountDeletionRequest.findFirstOrThrow({ where: { userId: u.id } });
    expect(row.confirmedAt).not.toBeNull();
    expect(row.cancelTokenHash).toBe(hashDeletionToken(cancelToken()));
    expect(JSON.stringify(row)).not.toContain(cancelToken());
  });

  it("login fica bloqueado durante a janela (senha certa) e volta apos cancelar; senha errada segue generico", async () => {
    const org = await mkOrg("login");
    const u = await givePassword(org);
    await mkSub(org.orgId);
    await requestAndConfirm(u, org);
    signOut();
    const blocked = await login({ email: u.email, password: PASS });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.errors.code).toEqual(["account_deletion_pending"]);
      expect(blocked.errors.scheduledFor?.[0]).toMatch(/^\d{4}-/);
    }
    expect(getCookie("lf_session") ?? null).toBeFalsy();
    const wrong = await login({ email: u.email, password: "errada-errada" });
    if (!wrong.ok) expect(wrong.errors.code).toBeUndefined();
    const c = await cancelAccountDeletionWithPassword({ email: u.email, password: PASS });
    expect(c.ok).toBe(true);
    const okLogin = await login({ email: u.email, password: PASS });
    expect(okLogin.ok).toBe(true);
  });
});

describe("login mobile", () => {
  it("fica bloqueado (403 account_deletion_pending) durante a janela e volta apos cancelar", async () => {
    const org = await mkOrg("mob");
    const u = await givePassword(org);
    await mkSub(org.orgId);
    await requestAndConfirm(u, org);
    const call = () =>
      mobileLogin(new Request("http://x/api/mobile/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: u.email, password: PASS, deviceName: "d", platform: "ios", appVersion: "1.0" }) }));
    const r = await call();
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe("account_deletion_pending");
    expect(await prisma.mobileDevice.count({ where: { userId: u.id } })).toBe(0);
    await cancelAccountDeletionWithPassword({ email: u.email, password: PASS });
    expect((await call()).status).toBe(200);
  });
});

describe("cancelamento", () => {
  it("por link do e-mail: reativa a conta, envia aviso 1x, token nao reutilizavel e a purga NAO executa", async () => {
    const org = await mkOrg("cnl");
    const u = await givePassword(org);
    await mkSub(org.orgId);
    const req = await requestAndConfirm(u, org);
    const ct = cancelToken();
    const prev = await previewAccountDeletionToken({ token: ct });
    expect(prev.ok && prev.data.valid && prev.data.kind).toBe("cancel");
    const r = await cancelAccountDeletionByToken({ token: ct });
    expect(r.ok).toBe(true);
    expect((await cancelAccountDeletionByToken({ token: ct })).ok).toBe(false);
    expect(mailsOf("account_deletion_cancelled")).toHaveLength(1);
    const res = await runAccountDeletionJob(new Date(Date.now() + 40 * DAY));
    expect(res.executed).toBe(0);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(user.email).toBe(u.email);
    expect(await prisma.membership.count({ where: { userId: u.id } })).toBe(1);
    expect((await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: req.id } })).cancelledAt).not.toBeNull();
    // pode pedir de novo
    await asUser(u, org);
    expect((await requestAccountDeletion({ password: PASS })).ok).toBe(true);
  });

  it("por sessao (pedido ainda nao confirmado) e confirmar link cancelado/expirado falha", async () => {
    const org = await mkOrg("cs");
    const u = await givePassword(org);
    await asUser(u, org);
    await requestAccountDeletion({ password: PASS });
    const t = confirmToken();
    expect((await cancelAccountDeletion()).ok).toBe(true);
    expect((await confirmAccountDeletion({ token: t })).ok).toBe(false);
    expect((await cancelAccountDeletion()).ok).toBe(false); // nada pendente
  });

  it("cancelar com senha errada/sem exclusao pendente e recusado", async () => {
    const org = await mkOrg("cw");
    const u = await givePassword(org);
    expect((await cancelAccountDeletionWithPassword({ email: u.email, password: "errada-errada" })).ok).toBe(false);
    const nop = await cancelAccountDeletionWithPassword({ email: u.email, password: PASS });
    expect(nop.ok).toBe(false);
    if (!nop.ok) expect(nop.errors.code).toEqual(["not_pending"]);
  });
});

describe("regras de organizacao (D-054-3)", () => {
  it("owner unico com outros membros: BLOQUEIA; com outro owner: permite", async () => {
    const org = await mkOrg("lo");
    const u = await givePassword(org);
    const other = await mkUser("member", org);
    await asUser(u, org);
    const r = await requestAccountDeletion({ password: PASS });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.code).toEqual(["blocked"]);
      expect(r.errors.blockers).toContain("last_owner_with_members");
      expect(r.errors._form[0]).toMatch(/proprietário/);
    }
    const st = await getAccountDeletionState();
    expect(st.ok && st.data.canRequest).toBe(false);
    expect(await prisma.accountDeletionRequest.count({ where: { userId: u.id } })).toBe(0);
    await prisma.membership.update({ where: { userId_orgId: { userId: other.id, orgId: org.orgId } }, data: { orgRole: "owner" } });
    expect((await requestAccountDeletion({ password: PASS })).ok).toBe(true);
  });

  it("unico membro com assinatura ativa/trial BLOQUEIA; cancelada ou agendada (cancelAtPeriodEnd) permite", async () => {
    const org = await mkOrg("as");
    const u = await givePassword(org);
    const sub = await mkSub(org.orgId, { status: "active", canceledAt: null, currentPeriodEnd: new Date(Date.now() + 10 * DAY) });
    await asUser(u, org);
    const r = await requestAccountDeletion({ password: PASS });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.blockers).toContain("active_subscription");
      expect(r.errors._form[0]).toMatch(/assinatura ativa/);
    }
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: "trialing" } });
    expect((await requestAccountDeletion({ password: PASS })).ok).toBe(false);
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: "active", cancelAtPeriodEnd: true } });
    expect((await requestAccountDeletion({ password: PASS })).ok).toBe(true);
    await prisma.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: false, status: "canceled" } });
    expect((await requestAccountDeletion({ password: PASS })).ok).toBe(true);
  });

  it("platform_admin nao pode excluir por este fluxo", async () => {
    const org = await mkOrg("pa");
    const u = await givePassword(org);
    await prisma.user.update({ where: { id: u.id }, data: { role: "platform_admin" } });
    await signInAs(u.id, { orgId: org.orgId, platformRole: "provider" });
    const r = await requestAccountDeletion({ password: PASS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.blockers).toContain("platform_admin");
  });

  it("assinatura ativada DURANTE a janela adia a purga (nunca org ativa orfa) sem enviar #14", async () => {
    const org = await mkOrg("pw");
    const u = await givePassword(org);
    await mkSub(org.orgId);
    const req = await requestAndConfirm(u, org);
    await prisma.subscription.update({ where: { orgId: org.orgId }, data: { status: "active", canceledAt: null, currentPeriodEnd: new Date(Date.now() + 10 * DAY) } });
    vi.mocked(sendSystemEmail).mockClear();
    const res = await runAccountDeletionJob(new Date(Date.now() + 31 * DAY));
    expect(res.blocked).toBe(1);
    expect(res.executed).toBe(0);
    expect(mailsOf("account_deleted")).toHaveLength(0);
    expect((await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: req.id } })).executedAt).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).email).toBe(u.email);
  });

  it("virar owner unico com outros membros durante a janela adia a purga (nunca org sem owner)", async () => {
    const org = await mkOrg("lw");
    const u = await givePassword(org);
    const other = await mkUser("owner", org);
    const req = await requestAndConfirm(u, org);
    await prisma.membership.update({ where: { userId_orgId: { userId: other.id, orgId: org.orgId } }, data: { orgRole: "member" } });
    const res = await runAccountDeletionJob(new Date(Date.now() + 31 * DAY));
    expect(res.blocked).toBe(1);
    expect(await prisma.membership.count({ where: { orgId: org.orgId, orgRole: "owner" } })).toBe(1);
    expect((await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: req.id } })).executedAt).toBeNull();
  });
});

describe("purga (execucao)", () => {
  it("antes da janela nada acontece; depois anonimiza, apaga o pessoal, preserva Campaign e envia #14 uma vez (rerodar nao duplica)", async () => {
    const org1 = await mkOrg("pg"); // U e O (owners): org continua
    const u = await givePassword(org1);
    const other = await mkUser("owner", org1);
    const org2 = await mkOrg("pg2"); // U unico membro, assinatura cancelada (fluxo 053/033)
    await prisma.membership.create({ data: { userId: u.id, orgId: org2.orgId, orgRole: "owner" } });
    await mkSub(org2.orgId, { canceledAt: new Date() });
    const org3 = await mkOrg("pg3"); // U e membro de org de terceiros
    await prisma.membership.create({ data: { userId: u.id, orgId: org3.orgId, orgRole: "member" } });
    await prisma.user.update({ where: { id: u.id }, data: { lastOrgId: org1.orgId, avatarUrl: "https://x/y.png" } });

    // dados do usuario
    const icp = await prisma.icpProfile.create({ data: { orgId: org1.orgId, name: "icp", niche: "n", signals: [], keywords: [], sources: [], desiredData: [] } });
    const camp = await prisma.campaign.create({ data: { orgId: org1.orgId, name: "Camp do U", icpId: icp.id, userId: u.id } });
    await prisma.emailAccount.create({ data: { orgId: org1.orgId, userId: u.id, provider: "smtp", smtpHost: "smtp.x", email: `zz-ea-${randomUUID()}@test.local`, encryptedPassword: "SEGREDO-CIFRADO" } });
    await prisma.passwordResetToken.create({ data: { userId: u.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + DAY) } });
    await prisma.mobileDevice.create({ data: { userId: u.id, name: "d", platform: "ios", refreshHash: randomUUID(), refreshExpiresAt: new Date(Date.now() + 1e9) } });
    await prisma.mobileActionLog.create({ data: { userId: u.id, deviceId: randomUUID(), action: "a", outcome: "ok" } });
    const inviteByU = await prisma.orgInvite.create({ data: { orgId: org1.orgId, email: "alguem@test.local", tokenHash: randomUUID(), expiresAt: new Date(Date.now() + DAY), createdByUserId: u.id, usedByUserId: u.id } });
    const inviteToU = await prisma.orgInvite.create({ data: { orgId: org3.orgId, email: u.email, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + DAY) } });
    const audit = await prisma.orgAuditLog.create({ data: { orgId: org1.orgId, actorUserId: u.id, targetUserId: u.id, action: "role_changed", meta: { note: "x" } } });
    const auditInvite = await prisma.orgAuditLog.create({ data: { orgId: org3.orgId, actorUserId: other.id, action: "member_invited", meta: { email: u.email, orgRole: "member" } } });
    const wh = await prisma.webhookEvent.create({ data: { orgId: org1.orgId, source: "mock", eventId: `e-${randomUUID()}`, payload: { customer: { email: u.email.toUpperCase(), id: "c1" }, amount: 100 } } });
    const free = await prisma.storedFile.create({ data: { orgId: org1.orgId, category: "attachment", blobKey: `orgs/${org1.orgId}/attachment/${randomUUID()}-a.txt`, originalName: "Contrato do Fulano.txt", mimeType: "text/plain", sizeBytes: 1, uploadedByUserId: u.id } });
    const used = await prisma.storedFile.create({ data: { orgId: org1.orgId, category: "creative", blobKey: `orgs/${org1.orgId}/creative/${randomUUID()}-v.mp4`, originalName: "v.mp4", mimeType: "video/mp4", sizeBytes: 1, uploadedByUserId: u.id } });
    const cr = await prisma.creative.create({ data: { orgId: org1.orgId, title: "t", script: "s", language: "pt-BR", avatarRef: "a", voiceRef: "v", aspectRatio: "9:16", createdBy: u.id, videoFileId: used.id } });
    await prisma.emailDispatchLog.create({ data: { scenario: "trial_started", dedupeKey: `t:${randomUUID()}`, userId: u.id } });
    const intLog = await prisma.integrationAuditLog.create({ data: { orgId: org1.orgId, userId: u.id, integration: "evolution" as never, action: "create" as never } });

    const req = await requestAndConfirm(u, org1);
    const before = new Date(Date.now() + 29 * DAY);
    expect((await runAccountDeletionJob(before)).executed).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).email).toBe(u.email);

    vi.mocked(sendSystemEmail).mockClear();
    const spies = [vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "log"), vi.spyOn(console, "info")];
    const due = new Date(Date.now() + 31 * DAY);
    const res = await runAccountDeletionJob(due);
    expect(res).toMatchObject({ executed: 1, emailsSent: 1, errors: 0 });

    // User anonimizado, linha mantida
    const user = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(user).toMatchObject({ name: ANONYMIZED_NAME, email: anonymizedEmail(u.id), passwordHash: null, avatarUrl: null, lastOrgId: null });
    expect(await prisma.membership.count({ where: { userId: u.id } })).toBe(0);
    // orgs seguem existindo; org1 mantem owner
    expect(await prisma.membership.count({ where: { orgId: org1.orgId, orgRole: "owner" } })).toBe(1);
    expect(await prisma.organization.count({ where: { id: { in: [org1.orgId, org2.orgId, org3.orgId] } } })).toBe(3);
    // Campaign preservada com autor anonimizado
    const c = await prisma.campaign.findUniqueOrThrow({ where: { id: camp.id } });
    expect(c.userId).toBe(u.id);
    expect((await prisma.creative.findUniqueOrThrow({ where: { id: cr.id } })).createdBy).toBe(u.id);
    // apagados
    expect(await prisma.emailAccount.count({ where: { userId: u.id } })).toBe(0);
    expect(await prisma.passwordResetToken.count({ where: { userId: u.id } })).toBe(0);
    expect(await prisma.mobileDevice.count({ where: { userId: u.id } })).toBe(0);
    expect(await prisma.mobileActionLog.count({ where: { userId: u.id } })).toBe(0);
    expect(await prisma.emailDispatchLog.count({ where: { userId: u.id } })).toBe(0);
    // arquivos: livre = soft delete e nome limpo; em uso por criativo = fica, sem autor
    const f1 = await prisma.storedFile.findUniqueOrThrow({ where: { id: free.id } });
    expect(f1.deletedAt).not.toBeNull();
    expect(f1.originalName).toBe("arquivo-removido");
    expect(f1.uploadedByUserId).toBeNull();
    const f2 = await prisma.storedFile.findUniqueOrThrow({ where: { id: used.id } });
    expect(f2.deletedAt).toBeNull();
    expect(f2.uploadedByUserId).toBeNull();
    // convites/auditoria
    const i1 = await prisma.orgInvite.findUniqueOrThrow({ where: { id: inviteByU.id } });
    expect(i1.createdByUserId).toBeNull();
    expect(i1.usedByUserId).toBeNull();
    const i2 = await prisma.orgInvite.findUniqueOrThrow({ where: { id: inviteToU.id } });
    expect(i2.email).toBe(anonymizedEmail(u.id));
    expect(i2.revokedAt).not.toBeNull();
    const a1 = await prisma.orgAuditLog.findUniqueOrThrow({ where: { id: audit.id } });
    expect(a1.actorUserId).toBeNull();
    expect(a1.targetUserId).toBeNull();
    const a2 = await prisma.orgAuditLog.findUniqueOrThrow({ where: { id: auditInvite.id } });
    expect(JSON.stringify(a2.meta)).not.toContain(u.email);
    // retencao: WebhookEvent permanece, sem o e-mail do usuario; log de integracao retido (6 meses)
    const w = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: wh.id } });
    expect(JSON.stringify(w.payload).toLowerCase()).not.toContain(u.email.toLowerCase());
    expect(JSON.stringify(w.payload)).toContain("[removido]");
    expect(JSON.stringify(w.payload)).toContain('"amount":100');
    expect(await prisma.integrationAuditLog.count({ where: { id: intLog.id } })).toBe(1);
    // pedido guarda so hash; executado
    const done = await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(done.executedAt).not.toBeNull();
    expect(JSON.stringify(done)).not.toContain(u.email);
    // sessoes invalidas e login impossivel
    const lg = await login({ email: u.email, password: PASS });
    expect(lg.ok).toBe(false);
    if (!lg.ok) expect(lg.errors._form[0]).toMatch(/inválidos/);
    // #14: ao e-mail ORIGINAL, 1x
    const gone = mailsOf("account_deleted");
    expect(gone).toHaveLength(1);
    expect(gone[0].to).toBe(u.email);
    // sem vazamento em logs
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain(u.email);

    // idempotencia: reroda (job e execucao direta) e nao duplica
    const again = await runAccountDeletionJob(new Date(due.getTime() + 60_000));
    expect(again).toMatchObject({ executed: 0 });
    expect((await executeAccountDeletion(req.id, due)).outcome).toBe("skipped");
    expect(mailsOf("account_deleted")).toHaveLength(1);

    // fluxo 053/033 da org do usuario unico: segue pelo expurgo normal de 90 dias (reuso, nada reimplementado)
    const lead = await purgeCanceledOrgs(new Date(Date.now() + CANCEL_RETENTION_MS + 2 * DAY));
    expect(lead.errors).toBe(0);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: org2.orgId } })).purgedAt).not.toBeNull();
  });

  it("execucoes concorrentes: so uma executa e o #14 sai uma vez", async () => {
    const org = await mkOrg("cc");
    const u = await givePassword(org);
    await mkSub(org.orgId);
    const req = await requestAndConfirm(u, org);
    vi.mocked(sendSystemEmail).mockClear();
    const due = new Date(Date.now() + 31 * DAY);
    const [a, b] = await Promise.all([executeAccountDeletion(req.id, due), executeAccountDeletion(req.id, due)]);
    expect([a.outcome, b.outcome].sort()).toEqual(["executed", "skipped"]);
    expect(mailsOf("account_deleted")).toHaveLength(1);
  });

  it("provider de e-mail falhando nao impede pedido, confirmacao nem exclusao", async () => {
    vi.mocked(sendSystemEmail).mockResolvedValue({ ok: false, error: new Error("smtp caiu") as never });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const org = await mkOrg("pf");
    const u = await givePassword(org);
    await mkSub(org.orgId);
    await asUser(u, org);
    const r = await requestAccountDeletion({ password: PASS });
    expect(r.ok && r.data.emailSent).toBe(false);
    // como o e-mail falhou, pegamos o token pelo hash conhecido: reprocessa com um token real gerado pela mesma funcao
    const row = await prisma.accountDeletionRequest.findFirstOrThrow({ where: { userId: u.id } });
    const { newDeletionToken } = await import("./constants");
    const t = newDeletionToken();
    await prisma.accountDeletionRequest.update({ where: { id: row.id }, data: { tokenHash: t.hash } });
    expect((await confirmAccountDeletion({ token: t.token })).ok).toBe(true);
    const res = await runAccountDeletionJob(new Date(Date.now() + 31 * DAY));
    expect(res.executed).toBe(1);
    expect(res.emailsSent).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).name).toBe(ANONYMIZED_NAME);
  });

  it("retencao: logs de auditoria vinculados somem so apos 6 meses; texto do e-mail #14 coincide com o que o codigo faz", async () => {
    const org = await mkOrg("rt");
    const u = await givePassword(org);
    await mkSub(org.orgId);
    await prisma.integrationAuditLog.create({ data: { orgId: org.orgId, userId: u.id, integration: "evolution" as never, action: "create" as never } });
    await requestAndConfirm(u, org);
    const due = new Date(Date.now() + 31 * DAY);
    await runAccountDeletionJob(due);
    expect(await prisma.integrationAuditLog.count({ where: { userId: u.id } })).toBe(1);
    expect(await purgeRetainedUserLogs(new Date(due.getTime() + 100 * DAY))).toBe(0);
    expect(await purgeRetainedUserLogs(new Date(due.getTime() + 200 * DAY))).toBe(1);
    expect(await prisma.integrationAuditLog.count({ where: { userId: u.id } })).toBe(0);
    expect(await purgeRetainedUserLogs(new Date(due.getTime() + 300 * DAY))).toBe(0); // idempotente

    const t = accountDeletedTemplate();
    for (const item of [...DELETED_ITEMS, ...ANONYMIZED_ITEMS, ...RETAINED_ITEMS]) {
      expect(t.text).toContain(item);
      expect(t.html).toContain(item.replace(/"/g, "&quot;"));
    }
    expect(t.text).toMatch(/5 anos/);
    expect(t.text).toMatch(/6 meses/);
    for (const h of ["Apagado", "Anonimizado", "Retido por obrigação legal"]) expect(t.text).toContain(h);
  });
});

describe("estado para o frontend", () => {
  it("none -> awaiting_confirmation -> scheduled (via banco, pois a sessao cai ao confirmar)", async () => {
    const org = await mkOrg("st");
    const u = await givePassword(org);
    await mkSub(org.orgId);
    await asUser(u, org);
    const s0 = await getAccountDeletionState();
    expect(s0.ok && s0.data).toMatchObject({ status: "none", canRequest: true, windowDays: DELETION_WINDOW_DAYS, blockers: [] });
    await requestAccountDeletion({ password: PASS });
    const s1 = await getAccountDeletionState();
    expect(s1.ok && s1.data.status).toBe("awaiting_confirmation");
    if (s1.ok) expect(s1.data.confirmationExpiresAt).toBeInstanceOf(Date);
    const prev = await previewAccountDeletionToken({ token: confirmToken() });
    expect(prev.ok && prev.data.valid && prev.data.kind).toBe("confirm");
    await confirmAccountDeletion({ token: confirmToken() });
    await prisma.user.update({ where: { id: u.id }, data: { sessionsInvalidatedAt: null } });
    await asUser(u, org);
    const s2 = await getAccountDeletionState();
    expect(s2.ok && s2.data.status).toBe("scheduled");
    if (s2.ok) {
      expect(s2.data.scheduledFor).toBeInstanceOf(Date);
      expect(s2.data.canRequest).toBe(false);
    }
    expect((await requestAccountDeletion({ password: PASS })).ok).toBe(false);
  });
});
