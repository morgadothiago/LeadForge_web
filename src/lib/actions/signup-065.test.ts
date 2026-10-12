import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sent: { to: string; scenario: string; text: string }[] = [];
vi.mock("@/lib/channels/system-mail", () => ({
  sendSystemEmail: vi.fn(async (to: string, _s: string, content: { text: string }, scenario: string) => {
    sent.push({ to, scenario, text: content.text });
    return { ok: true, messageId: "m1" };
  }),
}));

import { prisma } from "@/lib/prisma";
import { signInAs, signOut, testHeaders } from "@/lib/auth/test-helpers";
import { requireUser } from "@/lib/auth/require-user";
import { createOrgLimiter } from "@/lib/org/rate-limit";
import { docClaimHash, emailClaimHash } from "@/lib/billing/trial-claim";
import { parseDocument } from "@/lib/domain/document";
import { randomCnpj, randomCpf } from "@/lib/test-utils/document";
import { cleanupSignedUp } from "@/lib/test-utils/signup-cleanup";
import { renameOrganization, signUp } from "./billing";

const PW = { password: "senha-forte-123456", confirmPassword: "senha-forte-123456" };
const emails: string[] = [];
const claimHashes: string[] = [];
let ipN = 0;
const newIp = () => `10.65.${Math.floor(++ipN / 250)}.${(ipN % 250) + 1}`;
const setIp = (ip = newIp()) => {
  testHeaders.current = new Headers({ "x-real-ip": ip });
  return ip;
};
const mkEmail = (tag: string, domain = "test.local") => {
  const e = `zz-065-${tag}-${randomUUID().slice(0, 8)}@${domain}`;
  emails.push(e);
  return e;
};
async function signup(email: string, document: string, extra: Record<string, unknown> = {}) {
  setIp();
  const doc = parseDocument(document);
  if (doc) claimHashes.push(docClaimHash(doc));
  claimHashes.push(emailClaimHash(email));
  return signUp({ name: "Maria Souza", email, document, ...PW, ...extra });
}
const orgOf = async (email: string) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true, memberships: { select: { orgId: true } } } });
  const orgId = u.memberships[0].orgId;
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { status: true, suspendedReason: true, subscription: { select: { status: true, trialEndsAt: true, createdAt: true, plan: { select: { key: true } } } } } });
  return { userId: u.id, orgId, org };
};
const hasTrial = async (email: string) => {
  const { org } = await orgOf(email);
  return org.subscription!.trialEndsAt!.getTime() > Date.now() + 13 * 24 * 3600_000;
};

beforeAll(() => {
  process.env.TRUSTED_PROXY_IP_HEADER = "x-real-ip";
});
beforeEach(() => {
  sent.length = 0;
  signOut();
});
afterAll(async () => {
  await cleanupSignedUp(emails);
  await prisma.trialClaim.deleteMany({ where: { keyHash: { in: claimHashes } } });
  testHeaders.current = new Headers();
});

describe("signUp (SPEC-065) — cadastro cria usuario + organizacao + trial", () => {
  it("transacao unica: User + Organization + Membership(owner) + Subscription(free) + 2 TrialClaim (email e doc); sessao ja na org; redirect /dashboard", async () => {
    const email = mkEmail("ok");
    const cpf = randomCpf(true);
    const r = await signup(email, cpf);
    expect(r).toEqual({ ok: true, data: { redirectTo: "/dashboard" } });
    const { userId, orgId, org } = await orgOf(email);
    expect(org.subscription).toMatchObject({ status: "trialing", plan: { key: "free" } });
    expect(org.status).toBe("active");
    expect(await hasTrial(email)).toBe(true);
    const claims = await prisma.trialClaim.findMany({ where: { keyHash: { in: [emailClaimHash(email), docClaimHash(parseDocument(cpf)!)] } }, select: { kind: true } });
    expect(claims.map((c) => c.kind).sort()).toEqual(["doc", "email"]);
    // sessao real na organizacao criada (orgId da sessao = org do cadastro) e estado de acesso do trial
    const u = await requireUser();
    expect(u.id).toBe(userId);
    expect(u.orgId).toBe(orgId);
    expect(u.orgAccess).toBe("trial_ativo");
  });

  it("LGPD: so o hash e guardado — nenhum dado em claro (CPF/e-mail) em TrialClaim, nem em User/Organization alem do e-mail do proprio usuario", async () => {
    const email = mkEmail("lgpd");
    const cpf = randomCpf();
    await signup(email, cpf);
    const rows = await prisma.trialClaim.findMany({ where: { keyHash: { in: [emailClaimHash(email), docClaimHash(parseDocument(cpf)!)] } } });
    expect(rows).toHaveLength(2);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(cpf);
    expect(dump).not.toContain(email);
    for (const r of rows) expect(r.keyHash).toMatch(/^[0-9a-f]{64}$/);
    const org = await orgOf(email);
    expect(JSON.stringify(await prisma.user.findUniqueOrThrow({ where: { id: org.userId } }))).not.toContain(cpf);
    expect(JSON.stringify(await prisma.$queryRawUnsafe(`SELECT * FROM "User" WHERE "id" = '${org.userId}'`))).not.toContain(cpf);
  });

  it("e-mails: 1 welcome (com 'ate {data}. Sem cartao.') e 1 verificacao, pos-commit", async () => {
    const email = mkEmail("mail");
    await signup(email, randomCpf());
    const mine = sent.filter((s) => s.to === email);
    expect(mine.filter((s) => s.scenario === "welcome")).toHaveLength(1);
    expect(mine.filter((s) => s.scenario === "email_verification")).toHaveLength(1);
    expect(mine.find((s) => s.scenario === "welcome")!.text).toMatch(/14 dias grátis, até \d{2}\/\d{2}\/\d{4}\. Sem cartão\./);
  });

  it("documento invalido (digito, sequencia repetida, vazio) => erro de campo `document`; NADA criado (nem User, nem claim)", async () => {
    for (const bad of ["529.982.247-26", "111.111.111-11", "", "123"]) {
      const email = mkEmail("baddoc");
      const before = await prisma.trialClaim.count();
      const r = await signup(email, bad);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.errors.document?.[0], bad).toMatch(/CPF ou CNPJ/);
      expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
      expect(await prisma.trialClaim.count()).toBe(before);
    }
  });

  it("documento ausente => erro de campo", async () => {
    setIp();
    const r = await signUp({ name: "X", email: mkEmail("nodoc"), ...PW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.document?.[0]).toMatch(/CPF ou CNPJ/);
  });

  it("segundo cadastro com o MESMO e-mail canonico (a.b+x@gmail.com) => conta criada, trial ja EXPIRADO, org suspensa/automatic, mensagem generica", async () => {
    const tag = randomUUID().slice(0, 6);
    const first = `zz065a.b${tag}@gmail.com`;
    emails.push(first);
    const second = `zz065ab${tag}+promo@gmail.com`;
    emails.push(second);
    expect((await signup(first, randomCpf())).ok).toBe(true);
    expect(await hasTrial(first)).toBe(true);
    const r = await signup(second, randomCpf());
    expect(r).toEqual({ ok: true, data: { redirectTo: "/dashboard" } }); // mesma resposta: nao revela qual dado bateu
    expect(await hasTrial(second)).toBe(false);
    const { org } = await orgOf(second);
    expect(org.status).toBe("suspended");
    expect(org.suspendedReason).toBe("automatic");
    expect(org.subscription!.status).toBe("trialing");
    expect((await requireUser()).orgAccess).toBe("trial_expirado");
    expect(sent.filter((s) => s.to === second && s.scenario === "welcome")[0].text).not.toMatch(/14 dias/); // sem trial, sem a promessa
  });

  it("mesmo CPF com e-mail novo => sem trial; mesmo CNPJ, outra filial (mesma raiz) => sem trial; CNPJ de outra raiz => com trial", async () => {
    const cpf = randomCpf();
    const a = mkEmail("cpf-a");
    const b = mkEmail("cpf-b");
    expect((await signup(a, cpf)).ok).toBe(true);
    expect((await signup(b, cpf)).ok).toBe(true);
    expect(await hasTrial(a)).toBe(true);
    expect(await hasTrial(b)).toBe(false);

    const root = String(Math.floor(10_000_000 + Math.random() * 89_999_999));
    const c = mkEmail("cnpj-matriz");
    const d = mkEmail("cnpj-filial");
    const e = mkEmail("cnpj-outra");
    expect((await signup(c, randomCnpj({ root, branch: "0001", masked: true }))).ok).toBe(true);
    expect((await signup(d, randomCnpj({ root, branch: "0002" }))).ok).toBe(true);
    expect((await signup(e, randomCnpj())).ok).toBe(true);
    expect(await hasTrial(c)).toBe(true);
    expect(await hasTrial(d)).toBe(false);
    expect(await hasTrial(e)).toBe(true);
  });

  it("mesmo documento com mascara diferente (com/sem pontos) e o mesmo CPF", async () => {
    const raw = randomCpf();
    const masked = `${raw.slice(0, 3)}.${raw.slice(3, 6)}.${raw.slice(6, 9)}-${raw.slice(9)}`;
    const a = mkEmail("mask-a");
    const b = mkEmail("mask-b");
    await signup(a, raw);
    await signup(b, masked);
    expect(await hasTrial(a)).toBe(true);
    expect(await hasTrial(b)).toBe(false);
  });

  it("concorrencia: 2 cadastros simultaneos com o mesmo documento => exatamente 1 recebe o trial", async () => {
    const cpf = randomCpf();
    const a = mkEmail("race-a");
    const b = mkEmail("race-b");
    claimHashes.push(docClaimHash(parseDocument(cpf)!), emailClaimHash(a), emailClaimHash(b));
    setIp();
    const rs = await Promise.all([signUp({ name: "A", email: a, document: cpf, ...PW }), signUp({ name: "B", email: b, document: cpf, ...PW })]);
    expect(rs.every((r) => r.ok)).toBe(true);
    const trials = [await hasTrial(a), await hasTrial(b)];
    expect(trials.filter(Boolean)).toHaveLength(1);
  });

  it("os claims sobrevivem a exclusao da conta/organizacao: recadastrar nao renova o trial", async () => {
    const cpf = randomCpf();
    const a = mkEmail("del-a");
    await signup(a, cpf);
    expect(await hasTrial(a)).toBe(true);
    await cleanupSignedUp([a]); // remove usuario + org + assinatura (simula exclusao completa)
    const again = mkEmail("del-b");
    await signup(again, cpf);
    expect(await hasTrial(again)).toBe(false);
    await signup(mkEmail("del-c"), randomCpf()); // controle: documento novo => trial
    expect(await prisma.trialClaim.count({ where: { keyHash: emailClaimHash(a) } })).toBe(1);
  });

  it("teto de 3 trials novos por IP em 24 h; excedente cai no mesmo caminho 'ja expirado'; IP desconhecido nao e limitado", async () => {
    const ip = `172.30.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    const mk = async (n: number) => {
      const email = mkEmail(`ip${n}`);
      const cpf = randomCpf();
      claimHashes.push(docClaimHash(parseDocument(cpf)!), emailClaimHash(email));
      testHeaders.current = new Headers({ "x-real-ip": ip });
      expect((await signUp({ name: "IP", email, document: cpf, ...PW })).ok).toBe(true);
      return email;
    };
    const got = [await mk(1), await mk(2), await mk(3)];
    const over = await mk(4);
    for (const e of got) expect(await hasTrial(e)).toBe(true);
    expect(await hasTrial(over)).toBe(false);
  });

  it("dominio de e-mail descartavel => conta criada, trial ja expirado", async () => {
    const email = mkEmail("disp", "mailinator.com");
    expect((await signup(email, randomCpf())).ok).toBe(true);
    expect(await hasTrial(email)).toBe(false);
  });

  it("?plan&cadence validos preservados so como pre-selecao (/dashboard?plan=...); plano invalido, `free` e `business` ignorados", async () => {
    const a = mkEmail("intent-a");
    const ra = await signup(a, randomCpf(), { plan: "starter", cadence: "yearly" });
    expect(ra).toEqual({ ok: true, data: { redirectTo: "/dashboard?plan=starter&cadence=yearly" } });
    for (const plan of ["free", "business", "naoexiste", "courtesy"]) {
      const r = await signup(mkEmail("intent-x"), randomCpf(), { plan, cadence: "monthly" });
      expect(r, plan).toEqual({ ok: true, data: { redirectTo: "/dashboard" } });
    }
    // e nunca abre checkout sozinho: nenhuma Subscription ativa/incomplete
    const { org } = await orgOf(a);
    expect(org.subscription!.status).toBe("trialing");
  });

  it("e-mail ja cadastrado: mensagem generica; sem e-mail enviado; rate limit por IP continua valendo", async () => {
    const email = mkEmail("dup");
    await signup(email, randomCpf());
    sent.length = 0;
    const r = await signup(email, randomCpf());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(JSON.stringify(r.errors)).not.toMatch(/já existe|cadastrado/i);
    expect(sent).toHaveLength(0);
    const ip = setIp();
    const results = [];
    for (let i = 0; i < 6; i++) {
      testHeaders.current = new Headers({ "x-real-ip": ip });
      results.push(await signUp({ name: "RL", email: mkEmail(`rl${i}`), document: randomCpf(), ...PW }));
    }
    expect(results.some((x) => !x.ok && /Muitas tentativas/.test(x.errors._form?.[0] ?? ""))).toBe(true);
  });
});

describe("renameOrganization (D-065-22)", () => {
  it("owner renomeia a org da sessao (auditado, slug estavel); validacao; membro nao pode", async () => {
    const email = mkEmail("rename");
    await signup(email, randomCpf());
    const { orgId, userId } = await orgOf(email);
    const slugBefore = (await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).slug;
    createOrgLimiter.clear();
    const r = await renameOrganization({ name: "  Acme Ltda  " });
    expect(r).toEqual({ ok: true, data: { name: "Acme Ltda" } });
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect(org.name).toBe("Acme Ltda");
    expect(org.slug).toBe(slugBefore);
    const audit = await prisma.orgAuditLog.findFirst({ where: { orgId, action: "org_renamed" } });
    expect(audit?.actorUserId).toBe(userId);
    const bad = await renameOrganization({ name: "   " });
    expect(bad.ok).toBe(false);

    const memberId = randomUUID();
    await prisma.user.create({ data: { id: memberId, name: "m", email: `zz-065-member-${memberId.slice(0, 8)}@test.local`, role: "provider" } });
    emails.push(`zz-065-member-${memberId.slice(0, 8)}@test.local`);
    await prisma.membership.create({ data: { userId: memberId, orgId, orgRole: "member" } });
    await signInAs(memberId, { orgId, platformRole: "provider" });
    const denied = await renameOrganization({ name: "Hack" });
    expect(denied.ok).toBe(false);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).name).toBe("Acme Ltda");
  });

  it("sem sessao: sessao expirada", async () => {
    signOut();
    const r = await renameOrganization({ name: "X" });
    expect(r.ok).toBe(false);
  });
});
