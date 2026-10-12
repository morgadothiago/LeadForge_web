import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sent: { to: string; subject: string; html: string; text: string; scenario: string }[] = [];
const hoisted = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/channels/system-mail", () => ({
  sendSystemEmail: vi.fn(async (to: string, subject: string, content: { html: string; text: string }, scenario: string) => {
    if (hoisted.fail) return { ok: false, error: new Error("provider fora") };
    sent.push({ to, subject, html: content.html, text: content.text, scenario });
    return { ok: true, messageId: "m1" };
  }),
}));

import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { signInAs, signOut, testHeaders } from "@/lib/auth/test-helpers";
import { requireUser } from "@/lib/auth/require-user";
import { hashPassword } from "@/lib/auth/password";
import { newInviteToken } from "@/lib/org/tokens";
import { signUp } from "@/lib/actions/billing";
import { randomCpf } from "@/lib/test-utils/document";
import { signUpAndJoin } from "@/lib/actions/org";
import { forgotPassword, resendVerificationEmail, resetPassword, verifyEmail } from "@/lib/actions/auth";
import { dispatchDraft } from "@/lib/agents/drafts";
import { sendEmail } from "@/lib/channels/email";
import { sendWhatsApp } from "@/lib/channels/whatsapp";
import { clearForgotPasswordRateLimit, newResetToken } from "./password-reset";
import {
  clearResendRateLimit,
  hashVerificationToken,
  newVerificationToken,
  VERIFY_RESEND_COOLDOWN_MS,
  VERIFY_TOKEN_TTL_MS,
} from "./email-verification";
import { fromAddressForScenario } from "@/lib/channels/email/scenario";
import { welcomeTemplate } from "@/lib/channels/email/templates/welcome";
import { emailVerificationTemplate } from "@/lib/channels/email/templates/email-verification";
import { passwordChangedTemplate } from "@/lib/channels/email/templates/password-changed";

const PASS = "uma-senha-bem-longa-1";
const emails: string[] = [];
const rid = () => randomUUID().slice(0, 8);
const newEmail = (tag: string) => {
  const e = `zz-055-${tag}-${rid()}@test.local`;
  emails.push(e);
  return e;
};
const to = (email: string, scenario: string) => sent.filter((s) => s.to === email && s.scenario === scenario);
const linkToken = (html: string) => /verificar-email\?token=([\w-]+)/.exec(html)![1];

let org: TestOrg;

beforeAll(async () => {
  org = await createTestOrg("055");
});
afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, memberships: { select: { orgId: true } } } });
  for (const u of users) {
    for (const m of u.memberships) {
      if (m.orgId === org.orgId) continue;
      await prisma.subscription.deleteMany({ where: { orgId: m.orgId } });
      await prisma.orgAuditLog.deleteMany({ where: { orgId: m.orgId } });
      await prisma.membership.deleteMany({ where: { orgId: m.orgId } });
      await prisma.organization.deleteMany({ where: { id: m.orgId } });
    }
    await prisma.membership.deleteMany({ where: { userId: u.id } });
    await prisma.emailDispatchLog.deleteMany({ where: { userId: u.id } });
    await prisma.user.deleteMany({ where: { id: u.id } });
  }
  await prisma.orgInvite.deleteMany({ where: { orgId: org.orgId } });
  await purgeTestOrg(org);
});
beforeEach(() => {
  signOut();
  sent.length = 0;
  hoisted.fail = false;
  clearResendRateLimit();
  clearForgotPasswordRateLimit();
  testHeaders.current = new Headers({ "x-real-ip": "9.9.9.9" });
  process.env.TRUSTED_PROXY_IP_HEADER = "x-real-ip";
});

let ipN = 0;
async function signup(email: string, name = "Fulana Teste") {
  // signupLimiter e por IP (5/10min): cada cadastro simulado vem de um IP distinto; depois restaura o IP padrao.
  testHeaders.current = new Headers({ "x-real-ip": `10.55.${Math.floor(++ipN / 250)}.${(ipN % 250) + 1}` });
  try {
    return await signupRaw(email, name);
  } finally {
    testHeaders.current = new Headers({ "x-real-ip": "9.9.9.9" });
  }
}
async function signupRaw(email: string, name: string) {
  return signUp({ name, email, document: randomCpf(), password: "senha-forte-123456", confirmPassword: "senha-forte-123456" });
}

describe("boas-vindas (#1)", () => {
  it("signup novo envia 1 welcome (support, sem trial) e 1 e-mail de verificacao; usuario nasce NAO verificado", async () => {
    const email = newEmail("new");
    const r = await signup(email);
    expect(r.ok).toBe(true);
    expect(to(email, "welcome")).toHaveLength(1);
    expect(to(email, "email_verification")).toHaveLength(1);
    const w = to(email, "welcome")[0];
    // SPEC-065 (D-065-16.1): a org nasce no cadastro; o texto diz "14 dias gratis, ate {data}. Sem cartao." e leva ao /dashboard.
    expect(w.html).toContain("/dashboard");
    expect(w.text).toMatch(/14 dias grátis, até \d{2}\/\d{2}\/\d{4}\. Sem cartão\./);
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(u.emailVerifiedAt).toBeNull();
    expect(await prisma.emailDispatchLog.count({ where: { dedupeKey: `welcome:${u.id}` } })).toBe(1);
  });

  it("e-mail ja cadastrado: resposta identica a antes e NENHUM e-mail (anti-enumeracao)", async () => {
    const email = newEmail("dup");
    expect((await signup(email)).ok).toBe(true);
    sent.length = 0;
    clearResendRateLimit();
    const again = await signup(email);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.errors._form?.[0]).toMatch(/Não foi possível concluir o cadastro/);
    expect(sent).toHaveLength(0);
  });

  it("idempotente: sendWelcomeEmail duas vezes (retry/duplo submit) envia uma so vez", async () => {
    const { sendWelcomeEmail } = await import("./email-verification");
    const email = newEmail("idem");
    const u = await prisma.user.create({ data: { name: "Idem", email } });
    await sendWelcomeEmail({ id: u.id, name: u.name, email });
    await sendWelcomeEmail({ id: u.id, name: u.name, email });
    expect(to(email, "welcome")).toHaveLength(1);
  });

  it("falha do provider nao quebra o signup", async () => {
    hoisted.fail = true;
    const email = newEmail("fail");
    const r = await signup(email);
    expect(r.ok).toBe(true);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  it("signUpAndJoin por convite: welcome, sem e-mail de verificacao, e-mail verificado (D-055-6)", async () => {
    const email = newEmail("inv");
    const { token, hash } = newInviteToken();
    await prisma.orgInvite.create({ data: { orgId: org.orgId, email, orgRole: "member", tokenHash: hash, expiresAt: new Date(Date.now() + 86400_000) } });
    const r = await signUpAndJoin({ name: "Convidada", password: PASS, confirmPassword: PASS, token });
    expect(r.ok).toBe(true);
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(u.emailVerifiedAt).not.toBeNull();
    expect(to(email, "welcome")).toHaveLength(1);
    expect(to(email, "email_verification")).toHaveLength(0);
  });

  it("SPEC-062 (D-062-15): signUpAndJoin NAO aceita mais codigo (sem token => erro de validacao, nenhum usuario/e-mail)", async () => {
    const email = newEmail("code");
    const r = await signUpAndJoin({ name: "Por Codigo", email, password: PASS, confirmPassword: PASS, code: "ZZZZZZZZZZZZZZZZZZZZ" });
    expect(r.ok).toBe(false);
    expect(await prisma.user.count({ where: { email } })).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

describe("token de verificacao", () => {
  it("so hash no banco, token != hash, TTL 24h", async () => {
    const email = newEmail("tok");
    await signup(email);
    const token = linkToken(to(email, "email_verification")[0].html);
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    const rec = await prisma.emailVerificationToken.findFirstOrThrow({ where: { userId: u.id } });
    expect(rec.tokenHash).toBe(hashVerificationToken(token));
    expect(rec.tokenHash).not.toBe(token);
    expect(JSON.stringify(rec)).not.toContain(token);
    expect(VERIFY_TOKEN_TTL_MS).toBe(24 * 3600_000);
    expect(rec.expiresAt.getTime() - rec.createdAt.getTime()).toBeGreaterThan(23.9 * 3600_000);
    expect(rec.expiresAt.getTime() - rec.createdAt.getTime()).toBeLessThanOrEqual(24 * 3600_000 + 1000);
  });

  it("verifyEmail: verifica; reuso falha (uso unico); sem sessao funciona (link em outro navegador)", async () => {
    const email = newEmail("use");
    await signup(email);
    signOut();
    const token = linkToken(to(email, "email_verification")[0].html);
    const ok = await verifyEmail({ token });
    expect(ok.ok).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt).not.toBeNull();
    const again = await verifyEmail({ token });
    expect(again.ok).toBe(false);
  });

  it("aceita token como string pura", async () => {
    const email = newEmail("str");
    await signup(email);
    const token = linkToken(to(email, "email_verification")[0].html);
    expect((await verifyEmail(token)).ok).toBe(true);
  });

  it("expirado e inexistente/malformado: mesma mensagem generica, nada verificado", async () => {
    const email = newEmail("exp");
    await signup(email);
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    const { token, hash } = newVerificationToken();
    await prisma.emailVerificationToken.create({ data: { userId: u.id, email, tokenHash: hash, expiresAt: new Date(Date.now() - 1000) } });
    const expired = await verifyEmail({ token });
    const missing = await verifyEmail({ token: newVerificationToken().token });
    const junk = await verifyEmail({ token: "x" });
    for (const r of [expired, missing, junk]) expect(r.ok).toBe(false);
    expect(JSON.stringify(expired)).toBe(JSON.stringify(missing));
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt).toBeNull();
  });

  it("token de e-mail antigo (e-mail do usuario mudou) nao verifica", async () => {
    const email = newEmail("chg");
    await signup(email);
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    const { token, hash } = newVerificationToken();
    await prisma.emailVerificationToken.create({ data: { userId: u.id, email: "outro@test.local", tokenHash: hash, expiresAt: new Date(Date.now() + 1e6) } });
    expect((await verifyEmail({ token })).ok).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt).toBeNull();
  });

  it("uso concorrente: so uma chamada consome o token", async () => {
    const email = newEmail("race");
    await signup(email);
    const token = linkToken(to(email, "email_verification")[0].html);
    const rs = await Promise.all([verifyEmail({ token }), verifyEmail({ token }), verifyEmail({ token })]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
  });
});

describe("resendVerificationEmail", () => {
  async function loginUnverified(tag: string) {
    const email = newEmail(tag);
    await signup(email);
    sent.length = 0;
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    await signInAs(u.id); // SPEC-065: o cadastro ja cria a organizacao (sessao na org)
    return { email, userId: u.id };
  }

  it("sem sessao: Sessao expirada", async () => {
    const r = await resendVerificationEmail();
    expect(r.ok).toBe(false);
  });

  it("cooldown de 60s apos o e-mail do cadastro; depois do cooldown reenvia", async () => {
    const { email, userId } = await loginUnverified("cool");
    const blocked = await resendVerificationEmail();
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.errors.code).toEqual(["cooldown"]);
      expect(Number(blocked.errors.retryAfterSeconds[0])).toBeGreaterThan(0);
    }
    expect(to(email, "email_verification")).toHaveLength(0);
    await prisma.emailVerificationToken.updateMany({ where: { userId }, data: { createdAt: new Date(Date.now() - VERIFY_RESEND_COOLDOWN_MS - 1000) } });
    const ok = await resendVerificationEmail();
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.data).toEqual({ sent: true, alreadyVerified: false });
    expect(to(email, "email_verification")).toHaveLength(1);
    // o novo token tambem verifica
    expect((await verifyEmail({ token: linkToken(to(email, "email_verification")[0].html) })).ok).toBe(true);
  });

  it("rate limit por usuario (alem do cooldown)", async () => {
    const { userId } = await loginUnverified("rl");
    let limited = false;
    for (let i = 0; i < 8; i++) {
      await prisma.emailVerificationToken.updateMany({ where: { userId }, data: { createdAt: new Date(Date.now() - 120_000) } });
      const r = await resendVerificationEmail();
      if (!r.ok && r.errors.code?.[0] === "rate_limited") limited = true;
    }
    expect(limited).toBe(true);
  });

  it("rate limit por IP", async () => {
    const a = await loginUnverified("ip1");
    const { resendByIpLimiter } = await import("./email-verification");
    for (let i = 0; i < 20; i++) resendByIpLimiter.hit("ip:9.9.9.9");
    await prisma.emailVerificationToken.updateMany({ where: { userId: a.userId }, data: { createdAt: new Date(Date.now() - 120_000) } });
    const r = await resendVerificationEmail();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.code).toEqual(["rate_limited"]);
  });

  it("ja verificado: alreadyVerified, nenhum e-mail", async () => {
    const { userId } = await loginUnverified("done");
    await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    const r = await resendVerificationEmail();
    expect(r.ok && r.data).toEqual({ sent: false, alreadyVerified: true });
    expect(sent).toHaveLength(0);
  });

  it("requireUser expoe emailVerified (false ate confirmar, true depois)", async () => {
    const { userId } = await loginUnverified("flag");
    expect((await requireUser()).emailVerified).toBe(false);
    await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    expect((await requireUser()).emailVerified).toBe(true);
  });
});

describe("migration/backfill (D-055-3)", () => {
  it("usuarios criados sem informar o campo (existentes, fixtures, admin) nascem verificados", async () => {
    const u = await prisma.user.create({ data: { name: "Legado", email: newEmail("legacy") } });
    expect(u.emailVerifiedAt).not.toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: org.userId } })).emailVerifiedAt).not.toBeNull();
  });
});

describe("password_changed (#15)", () => {
  async function resetFlow(email: string) {
    const u = await prisma.user.create({ data: { name: "Reset", email, passwordHash: await hashPassword("senha-antiga-12345") } });
    const { token, hash } = newResetToken();
    await prisma.passwordResetToken.create({ data: { userId: u.id, tokenHash: hash, expiresAt: new Date(Date.now() + 1e6) } });
    return { u, token };
  }

  it("resetPassword envia aviso ao proprio e-mail, uma vez, sem link de acesso direto", async () => {
    const email = newEmail("pw");
    const { token } = await resetFlow(email);
    expect((await resetPassword({ token, password: PASS, confirmPassword: PASS })).ok).toBe(true);
    const mails = to(email, "password_changed");
    expect(mails).toHaveLength(1);
    expect(mails[0].html).toMatch(/Não foi você/);
    expect(mails[0].html).not.toContain(token);
    expect(mails[0].html).toContain("/esqueci-senha");
    expect((await resetPassword({ token, password: PASS, confirmPassword: PASS })).ok).toBe(false);
    expect(to(email, "password_changed")).toHaveLength(1);
  });

  it("token invalido: nenhum aviso", async () => {
    const r = await resetPassword({ token: "inexistente-inexistente", password: PASS, confirmPassword: PASS });
    expect(r.ok).toBe(false);
    expect(sent.filter((s) => s.scenario === "password_changed")).toHaveLength(0);
  });

  it("falha do provider nao quebra o reset", async () => {
    const email = newEmail("pwfail");
    const { token, u } = await resetFlow(email);
    hoisted.fail = true;
    expect((await resetPassword({ token, password: PASS, confirmPassword: PASS })).ok).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).sessionsInvalidatedAt).not.toBeNull();
  });

  it("forgotPassword nao revela existencia (mesma resposta) e nao envia password_changed", async () => {
    const real = await forgotPassword({ email: newEmail("fg") });
    const ghost = await forgotPassword({ email: `ninguem-${rid()}@test.local` });
    expect(JSON.stringify(real)).toBe(JSON.stringify(ghost));
    expect(sent.filter((s) => s.scenario === "password_changed")).toHaveLength(0);
  });
});

describe("enforcement D-055-7: nao-verificado nao envia mensagens", () => {
  let campId: string;
  let ownerId: string;
  let draftId: string;
  let leadId: string;
  beforeAll(async () => {
    const owner = await prisma.user.create({ data: { name: "Sender", email: newEmail("snd"), emailVerifiedAt: null } });
    ownerId = owner.id;
    const icp = await prisma.icpProfile.create({ data: { orgId: org.orgId, name: "zz055", niche: "x", signals: [], keywords: [], sources: [], desiredData: [] } });
    const camp = await prisma.campaign.create({ data: { name: "zz055", userId: ownerId, icpId: icp.id, orgId: org.orgId } });
    campId = camp.id;
    const lead = await prisma.lead.create({ data: { campaignId: campId, name: "Lead Zz", email: `lead-${rid()}@zz055.test`, phone: "+5511900000055", hasWhatsapp: true } });
    leadId = lead.id;
  });
  afterAll(async () => {
    await prisma.draft.deleteMany({ where: { leadId } });
    await prisma.agentRun.deleteMany({ where: { leadId } });
    await prisma.agent.deleteMany({ where: { orgId: org.orgId } });
    await prisma.touch.deleteMany({ where: { lead: { campaignId: campId } } });
    await prisma.lead.deleteMany({ where: { campaignId: campId } });
    await prisma.campaign.deleteMany({ where: { id: campId } });
    await prisma.icpProfile.deleteMany({ where: { orgId: org.orgId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  });

  it("sendEmail e sendWhatsApp adiam (deferred/email_not_verified), Touch volta a scheduled, nada e enviado", async () => {
    const now = new Date();
    for (const channel of ["email", "whatsapp"] as const) {
      const t = await prisma.touch.create({ data: { leadId, channel, status: "scheduled", scheduledAt: now } });
      const r = channel === "email" ? await sendEmail(t.id, { now }) : await sendWhatsApp(t.id, { now });
      expect(r.status).toBe("deferred");
      expect(r.status === "deferred" && "reason" in r ? r.reason : null).toBe("email_not_verified");
      const after = await prisma.touch.findUniqueOrThrow({ where: { id: t.id } });
      expect(after.status).toBe("scheduled");
      expect(after.scheduledAt!.getTime()).toBeGreaterThan(now.getTime());
      expect(after.sentAt).toBeNull();
    }
  });

  it("depois de verificar, o gate libera (Touch segue a politica normal; sem conta de e-mail => falha de config, nao adiamento)", async () => {
    await prisma.user.update({ where: { id: ownerId }, data: { emailVerifiedAt: new Date() } });
    const t = await prisma.touch.create({ data: { leadId, channel: "email", status: "scheduled", scheduledAt: new Date() } });
    const r = await sendEmail(t.id, { now: new Date() });
    expect(r.status === "deferred" && r.reason === "email_not_verified").toBe(false);
    await prisma.user.update({ where: { id: ownerId }, data: { emailVerifiedAt: null } });
  });

  it("dispatchDraft manual: erro tipado email_not_verified e rascunho segue pendente (nenhum Touch criado)", async () => {
    const agent = await prisma.agent.create({ data: { orgId: org.orgId, role: "sdr", name: "zz055" } });
    const run = await prisma.agentRun.create({ data: { agentId: agent.id, leadId, trigger: "zz055" } });
    const draft = await prisma.draft.create({ data: { agentRunId: run.id, leadId, channel: "email", subject: "Oi", body: "Corpo" } });
    draftId = draft.id;
    const before = await prisma.touch.count({ where: { leadId } });
    await expect(dispatchDraft(draft.id, { reviewer: ownerId, orgId: org.orgId })).rejects.toMatchObject({ code: "email_not_verified" });
    expect((await prisma.draft.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("pending");
    expect(await prisma.touch.count({ where: { leadId } })).toBe(before);
    // a action converte para ActionResult com code tipado
    const { handleActionError } = await import("@/lib/actions/result");
    const { emailNotVerifiedError } = await import("./email-verification");
    const res = handleActionError(emailNotVerifiedError());
    expect(!res.ok && res.errors.code).toEqual(["email_not_verified"]);
  });
});

describe("cenarios e templates", () => {
  it("remetentes: welcome=support, email_verification/password_changed=noreply (Resend e ACS)", () => {
    const env = { RESEND_FROM_SUPPORT: "s@x.com", RESEND_FROM_NOREPLY: "n@x.com", ACS_FROM_SUPPORT: "as@x.com", ACS_FROM_NOREPLY: "an@x.com" };
    expect(fromAddressForScenario("welcome", env)).toBe("s@x.com");
    expect(fromAddressForScenario("email_verification", env)).toBe("n@x.com");
    expect(fromAddressForScenario("password_changed", env)).toBe("n@x.com");
    expect(fromAddressForScenario("welcome", env, "acs")).toBe("as@x.com");
    expect(fromAddressForScenario("password_changed", env, "acs")).toBe("an@x.com");
  });

  it("snapshots de template (conteudo essencial, escape e sem dado sensivel)", () => {
    const w = welcomeTemplate({ name: "<b>Ana</b> Souza", link: "https://app/dashboard" });
    expect(w.subject).toBe("Bem-vindo à LeadForge");
    expect(w.html).not.toContain("<b>Ana</b>");
    expect(w.html).toContain("https://app/dashboard");
    expect(w.text).toContain("https://app/dashboard");
    const v = emailVerificationTemplate({ link: "https://app/verificar-email?token=abc" });
    expect(v.subject).toBe("Confirme seu e-mail — LeadForge");
    expect(v.html).toContain("24 horas");
    expect(v.text).toContain("https://app/verificar-email?token=abc");
    const p = passwordChangedTemplate({ changedAt: new Date("2026-10-10T15:00:00Z"), resetLink: "https://app/esqueci-senha" });
    expect(p.subject).toBe("Sua senha foi alterada — LeadForge");
    expect(p.text).toContain("10/10/2026, 12:00");
    expect(p.text).toContain("Não foi você?");
    expect(p.text).not.toMatch(/token=/);
  });
});
