import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "./password";
import { signSessionToken, verifySessionToken } from "./session-token";
import { requireUser, UnauthorizedError } from "./require-user";
import { safeNext } from "./safe-redirect";
import { _clearRateLimit, _storeSize, emailKey, isRateLimited, loginKey, LOGIN_MAX_FAILURES, LOGIN_MAX_FAILURES_PER_EMAIL, LOGIN_WINDOW_MS, MAX_ENTRIES, recordFailure } from "./rate-limit";
import { getClientIp } from "./client-ip";
import { SignJWT } from "jose";
import { getSession } from "./session";
import { SESSION_COOKIE } from "./config";
import { getCookie, setCookie, signInAs, signOut, testHeaders } from "./test-helpers";
import { clearForgotPasswordRateLimit, hashResetToken, newResetToken, RESET_TOKEN_TTL_MS } from "./password-reset";
import { login, logout, forgotPassword, resetPassword } from "@/lib/actions/auth";
import { sendSystemEmail } from "@/lib/channels/system-mail";
import { seedAdmin } from "../../../prisma/seed";
import { proxy } from "@/proxy";
import { NextRequest } from "next/server";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/channels/system-mail", () => ({ sendSystemEmail: vi.fn(async () => ({ ok: true, messageId: "" })) }));

const EMAIL = "zz-test-auth@leadforge.local";
const PASS = "Senha-Forte-Teste-123";
let userId = "";
let orgId = "";

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz-test-auth" } } });
  const u = await prisma.user.create({ data: { name: "T", email: EMAIL, passwordHash: await hashPassword(PASS) } });
  userId = u.id;
  // SPEC-030: `provider` (papel default) só loga com sessão se tiver Membership/Organization (D-30-1: login resolve a org do usuário).
  const org = await prisma.organization.create({ data: { name: "zz-test-auth org", slug: `zz-test-auth-org-${u.id.slice(0, 8)}`, status: "active" } });
  orgId = org.id;
  await prisma.membership.create({ data: { userId, orgId, orgRole: "owner" } });
});
afterAll(async () => {
  await prisma.membership.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz-test-auth" } } });
  if (orgId) await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.$disconnect();
});
beforeEach(() => {
  signOut();
  _clearRateLimit();
  clearForgotPasswordRateLimit();
  vi.mocked(sendSystemEmail).mockClear();
  process.env.TRUSTED_PROXY_IP_HEADER = "x-real-ip";
  testHeaders.current = new Headers({ "x-real-ip": "1.2.3.4" });
});

describe("senha", () => {
  it("hash argon2id e verify", async () => {
    const h = await hashPassword("abc12345");
    expect(h).toMatch(/^\$argon2id\$/);
    expect(h).not.toContain("abc12345");
    expect(await verifyPassword(h, "abc12345")).toBe(true);
    expect(await verifyPassword(h, "outra")).toBe(false);
    expect(await verifyPassword("lixo", "x")).toBe(false);
  });
});

describe("sessão", () => {
  it("token válido", async () => {
    expect(await verifySessionToken(await signSessionToken("u1", null, "provider"))).toEqual({ userId: "u1", orgId: null, platformRole: "provider", issuedAtMs: expect.any(Number) });
  });
  it("expirado", async () => {
    const t = await signSessionToken("u1", null, "provider", { now: new Date(Date.now() - 10_000), ttlSeconds: 1 });
    expect(await verifySessionToken(t)).toBeNull();
  });
  it("adulterado / segredo diferente / ausente", async () => {
    const t = await signSessionToken("u1", null, "provider");
    const [h, p, s] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "admin", exp: 9999999999 })).toString("base64url");
    expect(await verifySessionToken(`${h}.${forged}.${s}`)).toBeNull();
    expect(await verifySessionToken(`${h}.${p}.x${s}`)).toBeNull();
    expect(await verifySessionToken(t, "y".repeat(40))).toBeNull();
    expect(await verifySessionToken(undefined)).toBeNull();
  });
  it("expirado (exp no passado, assinatura válida) rejeitado", async () => {
    const t = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("u").setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
    expect(await verifySessionToken(t)).toBeNull();
  });
  it("assinado com outro segredo rejeitado", async () => {
    expect(await verifySessionToken(await signSessionToken("u", null, "provider", { secret: "z".repeat(48) }))).toBeNull();
  });
  it("alg none rejeitado", async () => {
    const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    expect(await verifySessionToken(`${b({ alg: "none" })}.${b({ sub: "u", exp: 9999999999 })}.`)).toBeNull();
  });
});

describe("requireUser", () => {
  it("sem sessão lança UnauthorizedError", async () => {
    await expect(requireUser()).rejects.toBeInstanceOf(UnauthorizedError);
  });
  it("com sessão retorna o usuário", async () => {
    await signInAs(userId);
    expect((await requireUser()).email).toBe(EMAIL);
  });
  it("expõe o role de PLATAFORMA do usuário (provider por padrão, platform_admin quando definido) — SPEC-030", async () => {
    // usuário dedicado (não o `userId` compartilhado do describe "login/logout", para não contaminá-lo).
    const u = await prisma.user.create({ data: { name: "role-test", email: "zz-test-auth-role@leadforge.local" } });
    try {
      await signInAs(u.id, { orgId: null, platformRole: "provider" });
      expect((await requireUser()).role).toBe("provider");
      await prisma.user.update({ where: { id: u.id }, data: { role: "platform_admin" } });
      expect((await requireUser()).role).toBe("platform_admin");
    } finally {
      await prisma.user.delete({ where: { id: u.id } });
    }
  });
  it("usuário removido -> UnauthorizedError", async () => {
    await signInAs("00000000-0000-4000-8000-00000000dead", { orgId: null, platformRole: "provider" });
    await expect(requireUser()).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("login/logout", () => {
  it("ok: cria cookie e redireciona a next seguro", async () => {
    const r = await login({ email: ` ${EMAIL.toUpperCase()} `, password: PASS, next: "/leads?x=1" });
    expect(r).toEqual({ ok: true, data: { redirectTo: "/leads?x=1" } });
    expect((await getSession())?.userId).toBe(userId);
    expect(getCookie(SESSION_COOKIE)).toBeTruthy();
  });
  it("erro genérico idêntico p/ usuário inexistente e senha errada", async () => {
    const a = await login({ email: "nao-existe@x.com", password: "qualquer123" });
    const b = await login({ email: EMAIL, password: "errada" });
    expect(a).toEqual({ ok: false, errors: { _form: ["E-mail ou senha inválidos."] } });
    expect(b).toEqual(a);
    expect(getCookie(SESSION_COOKIE)).toBeUndefined();
  });
  it("usuário sem passwordHash falha igual", async () => {
    await prisma.user.create({ data: { name: "S", email: "zz-test-auth-nohash@x.com" } });
    expect(await login({ email: "zz-test-auth-nohash@x.com", password: "x" })).toEqual({
      ok: false, errors: { _form: ["E-mail ou senha inválidos."] },
    });
  });
  it("validação Zod PT-BR", async () => {
    const r = await login({ email: "", password: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.email?.[0]).toBe("E-mail é obrigatório.");
  });
  it("next inválido cai em /", async () => {
    for (const next of ["//evil.com", "https://evil.com", "/\\evil.com", "evil.com", "javascript:alert(1)", "/login"]) {
      const r = await login({ email: EMAIL, password: PASS, next });
      expect(r).toEqual({ ok: true, data: { redirectTo: "/dashboard" } });
    }
  });
  it("rate limit após N falhas, mesmo com senha correta; outro IP não é afetado", async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await login({ email: EMAIL, password: "errada" });
    const r = await login({ email: EMAIL, password: PASS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors._form?.[0]).toMatch(/Muitas tentativas/);
    testHeaders.current = new Headers({ "x-real-ip": "9.9.9.9" });
    expect((await login({ email: EMAIL, password: PASS })).ok).toBe(true);
  });
  it("rotação de x-forwarded-for não burla; sem env o IP é 'unknown' e o limite por e-mail vale", async () => {
    delete process.env.TRUSTED_PROXY_IP_HEADER;
    expect(getClientIp(new Headers({ "x-forwarded-for": "8.8.8.8", "x-real-ip": "7.7.7.7" }))).toBe("unknown");
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
      testHeaders.current = new Headers({ "x-forwarded-for": `10.0.0.${i}` });
      await login({ email: EMAIL, password: "errada" });
    }
    testHeaders.current = new Headers({ "x-forwarded-for": "10.9.9.9" });
    const r = await login({ email: EMAIL, password: PASS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors._form?.[0]).toMatch(/Muitas tentativas/);
  });
  it("limite por e-mail com IPs rotativos confiáveis: teto de 20 e mensagem genérica", () => {
    const now = 1_000_000;
    for (let i = 0; i < LOGIN_MAX_FAILURES_PER_EMAIL; i++) recordFailure(loginKey("v@x.com", `ip${i}`), emailKey("v@x.com"), now);
    expect(isRateLimited(loginKey("v@x.com", "novo"), emailKey("v@x.com"), now + 3_600_000 > now + LOGIN_WINDOW_MS ? now + 1 : now)).toBe(true);
    expect(isRateLimited(loginKey("v@x.com", "novo"), emailKey("v@x.com"), now + LOGIN_WINDOW_MS + 1)).toBe(false);
  });
  it("backoff progressivo bloqueia antes do teto", () => {
    const now = 5_000_000;
    const k = loginKey("b@x.com", "ip");
    for (let i = 0; i < 3; i++) recordFailure(k, undefined, now);
    expect(isRateLimited(k, undefined, now)).toBe(true); // 3ª falha: atraso 2s
    expect(isRateLimited(k, undefined, now + 3000)).toBe(false);
  });
  it("store tem teto duro (FIFO) e limpa expiradas", () => {
    _clearRateLimit();
    for (let i = 0; i < MAX_ENTRIES + 50; i++) recordFailure(`k${i}|ip`, undefined, 1);
    expect(_storeSize()).toBeLessThanOrEqual(MAX_ENTRIES);
    expect(isRateLimited("k0|ip", undefined, 2)).toBe(false); // mais antiga evictada
    expect(isRateLimited(`k${MAX_ENTRIES + 49}|ip`, undefined, 2)).toBe(false); // 1 falha: sob o limite, ainda presente
    recordFailure("novo|ip", undefined, 1 + LOGIN_WINDOW_MS + 1); // expiradas são varridas
    expect(_storeSize()).toBe(1);
  });
  it("logout remove o cookie", async () => {
    await signInAs(userId);
    expect(await logout()).toEqual({ ok: true, data: { redirectTo: "/login" } });
    expect(await getSession()).toBeNull();
  });
});

/** SPEC-038: extrai o token em claro do link enviado (a única forma de obtê-lo — o banco só guarda o hash). */
function extractToken(text: string): string {
  const m = /token=([^\s]+)/.exec(text);
  if (!m) throw new Error("link sem token no corpo do e-mail (mock)");
  return m[1];
}

describe("forgotPassword / resetPassword (SPEC-038)", () => {
  const PW_EMAIL = "zz-test-auth-pwreset@leadforge.local";
  const PW_PASS = "Senha-Forte-Original-123";
  const NEW_PASS = "Senha-Forte-Nova-456!!";
  let pwUserId = "";
  let pwOrgId = "";

  beforeAll(async () => {
    const u = await prisma.user.create({ data: { name: "PwReset", email: PW_EMAIL, passwordHash: await hashPassword(PW_PASS) } });
    pwUserId = u.id;
    // login() (provider) só cria sessão com Membership/Organization (D-30-1) — precisa existir para o teste de "login com a senha nova funciona".
    const org = await prisma.organization.create({ data: { name: "zz-test-auth-pwreset org", slug: `zz-test-auth-pwreset-org-${u.id.slice(0, 8)}`, status: "active" } });
    pwOrgId = org.id;
    await prisma.membership.create({ data: { userId: pwUserId, orgId: pwOrgId, orgRole: "owner" } });
  });
  afterAll(async () => {
    await prisma.membership.deleteMany({ where: { userId: pwUserId } });
    await prisma.passwordResetToken.deleteMany({ where: { userId: pwUserId } });
    await prisma.user.deleteMany({ where: { id: pwUserId } });
    if (pwOrgId) await prisma.organization.deleteMany({ where: { id: pwOrgId } });
  });

  it("resposta genérica idêntica para e-mail existente e inexistente (sem vazar existência)", async () => {
    const a = await forgotPassword({ email: PW_EMAIL });
    testHeaders.current = new Headers({ "x-real-ip": "1.2.3.5" }); // evita colidir com o limite por IP do passo acima
    const b = await forgotPassword({ email: "zz-test-auth-nao-existe@leadforge.local" });
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
  });

  it("e-mail inexistente: nenhum token é criado e nenhum e-mail é enviado", async () => {
    const before = await prisma.passwordResetToken.count();
    await forgotPassword({ email: "zz-test-auth-nao-existe-2@leadforge.local" });
    expect(await prisma.passwordResetToken.count()).toBe(before);
    expect(sendSystemEmail).not.toHaveBeenCalled();
  });

  it("e-mail existente: cria token (só o hash — nunca o valor em claro) e envia o e-mail com o link", async () => {
    const r = await forgotPassword({ email: PW_EMAIL });
    expect(r.ok).toBe(true);
    expect(sendSystemEmail).toHaveBeenCalledTimes(1);
    const [to, , content] = vi.mocked(sendSystemEmail).mock.calls[0];
    expect(to).toBe(PW_EMAIL);
    expect(content.text).toContain("/redefinir-senha?token=");
    expect(content.html).toContain("/redefinir-senha?token=");
    const token = extractToken(content.text);
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashResetToken(token) } });
    expect(record).not.toBeNull();
    expect(record!.userId).toBe(pwUserId);
    expect(record!.usedAt).toBeNull();
    expect(record!.tokenHash).not.toBe(token); // nunca o valor em claro
    expect(record!.expiresAt.getTime()).toBeGreaterThan(Date.now() + RESET_TOKEN_TTL_MS - 60_000);
    expect(record!.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + RESET_TOKEN_TTL_MS + 5_000);
  });

  it("validação Zod PT-BR (e-mail vazio/inválido)", async () => {
    const r = await forgotPassword({ email: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.email?.[0]).toBe("E-mail é obrigatório.");
  });

  it("rate limit por e-mail: 6ª tentativa para o MESMO e-mail bloqueia mesmo variando o IP", async () => {
    for (let i = 0; i < 5; i++) {
      testHeaders.current = new Headers({ "x-real-ip": `20.0.0.${i}` }); // IP diferente a cada chamada
      const r = await forgotPassword({ email: PW_EMAIL });
      expect(r.ok).toBe(true);
    }
    testHeaders.current = new Headers({ "x-real-ip": "20.0.0.99" }); // ainda outro IP novo
    const blocked = await forgotPassword({ email: PW_EMAIL });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.errors._form?.[0]).toMatch(/Muitas tentativas/);
  });

  it("rate limit por IP: 21ª tentativa do MESMO IP bloqueia mesmo variando o e-mail", async () => {
    testHeaders.current = new Headers({ "x-real-ip": "30.0.0.1" });
    for (let i = 0; i < 20; i++) {
      const r = await forgotPassword({ email: `zz-test-auth-iprl-${i}@leadforge.local` });
      expect(r.ok).toBe(true);
    }
    const blocked = await forgotPassword({ email: "zz-test-auth-iprl-novo@leadforge.local" });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.errors._form?.[0]).toMatch(/Muitas tentativas/);
  });

  it("token inválido/inexistente é rejeitado com erro genérico", async () => {
    const r = await resetPassword({ token: "token-que-nunca-existiu", password: NEW_PASS });
    expect(r).toEqual({ ok: false, errors: { _form: ["Link de redefinição inválido ou expirado. Solicite um novo link."] } });
  });

  it("token expirado (24h + 1min) é rejeitado; token não é marcado como usado", async () => {
    const { token, hash } = newResetToken();
    await prisma.passwordResetToken.create({
      data: { userId: pwUserId, tokenHash: hash, expiresAt: new Date(Date.now() - (RESET_TOKEN_TTL_MS + 60_000)) },
    });
    const r = await resetPassword({ token, password: NEW_PASS });
    expect(r.ok).toBe(false);
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hash } });
    expect(record!.usedAt).toBeNull();
  });

  it("senha nova fraca é rejeitada (mesma validação Zod do signup, 12+ caracteres); token permanece não usado", async () => {
    const { token, hash } = newResetToken();
    await prisma.passwordResetToken.create({ data: { userId: pwUserId, tokenHash: hash, expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) } });
    const r = await resetPassword({ token, password: "curta123" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.password?.[0]).toBe("Senha deve ter ao menos 12 caracteres.");
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hash } });
    expect(record!.usedAt).toBeNull();
  });

  it("fluxo feliz completo: pedir reset -> redefinir -> sessões antigas invalidadas -> login com a senha nova funciona", async () => {
    // sessão ANTES da redefinição (simula o usuário já logado noutro dispositivo/aba).
    await signInAs(pwUserId, { orgId: null, platformRole: "provider" });
    expect((await requireUser()).id).toBe(pwUserId);
    const oldCookie = getCookie(SESSION_COOKIE)!;

    testHeaders.current = new Headers({ "x-real-ip": "40.0.0.1" });
    const req = await forgotPassword({ email: PW_EMAIL });
    expect(req.ok).toBe(true);
    const content = vi.mocked(sendSystemEmail).mock.calls.at(-1)![2];
    const token = extractToken(content.text);

    const reset = await resetPassword({ token, password: NEW_PASS });
    expect(reset).toEqual({ ok: true, data: { redirectTo: "/login" } });

    // D-038-2: a sessão antiga (emitida ANTES da redefinição) deixa de valer.
    signOut();
    // reintroduz explicitamente o cookie antigo (signOut limpou o jar) para simular a aba que continuava logada.
    setCookie(SESSION_COOKIE, oldCookie);
    await expect(requireUser()).rejects.toBeInstanceOf(UnauthorizedError);

    // login com a senha ANTIGA falha; com a NOVA funciona.
    signOut();
    testHeaders.current = new Headers({ "x-real-ip": "40.0.0.2" });
    const oldLogin = await login({ email: PW_EMAIL, password: PW_PASS });
    expect(oldLogin.ok).toBe(false);
    const newLogin = await login({ email: PW_EMAIL, password: NEW_PASS });
    expect(newLogin.ok).toBe(true);
  });

  it("token já usado (reuso bloqueado): a 2ª chamada com o mesmo token falha", async () => {
    const { token, hash } = newResetToken();
    await prisma.passwordResetToken.create({ data: { userId: pwUserId, tokenHash: hash, expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) } });
    const first = await resetPassword({ token, password: "Outra-Senha-Forte-789" });
    expect(first.ok).toBe(true);
    const second = await resetPassword({ token, password: "Mais-Uma-Senha-000" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.errors._form?.[0]).toMatch(/inválido ou expirado/);
  });
});

describe("safeNext", () => {
  it("aceita só caminhos internos", () => {
    expect(safeNext("/campanhas/1?a=b")).toBe("/campanhas/1?a=b");
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil", "", undefined, 5, "/a\nb", "/%2f%2fevil.com", "/%2F%2Fevil.com", " /x", " //evil.com", "/a\tb", "\t/x", "\n/x", "javascript:alert(1)", "/javascript:alert(1)\n"]) expect(safeNext(bad), String(bad)).toBe("/dashboard");
  });
});

describe("seedAdmin", () => {
  it("pula sem senha e é idempotente com senha", async () => {
    expect(await seedAdmin(prisma, {})).toBe("skipped");
    const env = { ADMIN_EMAIL: "ZZ-test-auth-seed@leadforge.local", ADMIN_PASSWORD: "senha-longa-123456" };
    expect(await seedAdmin(prisma, env)).toBe("upserted");
    expect(await seedAdmin(prisma, env)).toBe("upserted");
    const users = await prisma.user.findMany({ where: { email: "zz-test-auth-seed@leadforge.local" } });
    expect(users).toHaveLength(1);
    expect(users[0].passwordHash).toMatch(/^\$argon2id\$/);
    await expect(seedAdmin(prisma, { ADMIN_EMAIL: "a@b.com", ADMIN_PASSWORD: "curta" })).rejects.toThrow();
  });
});

describe("proxy", () => {
  const req = (p: string, cookie?: string) =>
    new NextRequest(`http://localhost:3000${p}`, cookie ? { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } } : undefined);
  it("sem sessão redireciona para /login?next=", async () => {
    const r = await proxy(req("/leads?a=1"));
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fleads%3Fa%3D1");
  });
  it("token inválido redireciona (rota protegida); válido passa; /login, / e /signup passam sempre", async () => {
    expect((await proxy(req("/leads", "lixo"))).status).toBe(307);
    expect((await proxy(req("/leads", await signSessionToken("u", null, "provider")))).headers.get("location")).toBeNull();
    expect((await proxy(req("/login"))).headers.get("location")).toBeNull();
    // SPEC-035/034: "/" (landing) e "/signup" (signup self-service) são publicas por design — o proxy
    // deixa passar mesmo sem sessao/com sessao invalida; a pagina decide (deslogado ve a landing/form,
    // logado e redirecionado para /dashboard dentro do proprio page.tsx).
    expect((await proxy(req("/"))).headers.get("location")).toBeNull();
    expect((await proxy(req("/", "lixo"))).headers.get("location")).toBeNull();
    expect((await proxy(req("/signup"))).headers.get("location")).toBeNull();
    expect((await proxy(req("/signup", "lixo"))).headers.get("location")).toBeNull();
  });
  it("SPEC-038: /esqueci-senha e /redefinir-senha (com token na query) passam sempre, com ou sem sessão", async () => {
    // Regressão do achado de QA (mesma classe de bug de SPEC-035/037): rotas públicas de
    // recuperação de senha esquecidas na lista de isenção do proxy — o público-alvo exato
    // desse fluxo é o usuário DESLOGADO, que não pode ser redirecionado para /login.
    expect((await proxy(req("/esqueci-senha"))).headers.get("location")).toBeNull();
    expect((await proxy(req("/esqueci-senha", "lixo"))).headers.get("location")).toBeNull();
    expect((await proxy(req("/esqueci-senha", await signSessionToken("u", null, "provider")))).headers.get("location")).toBeNull();

    expect((await proxy(req("/redefinir-senha"))).headers.get("location")).toBeNull();
    expect((await proxy(req("/redefinir-senha", "lixo"))).headers.get("location")).toBeNull();
    expect((await proxy(req("/redefinir-senha", await signSessionToken("u", null, "provider")))).headers.get("location")).toBeNull();

    // Cenário exato reproduzido pelo QA: link recebido por e-mail, com token na query string, sem sessão.
    expect((await proxy(req("/redefinir-senha?token=abc123"))).status).toBe(200);
    expect((await proxy(req("/redefinir-senha?token=abc123"))).headers.get("location")).toBeNull();
  });
  it("matcher: só assets exatos passam; paths dinâmicos com extensão são protegidos", async () => {
    const { config } = await import("@/proxy");
    const re = new RegExp(`^${config.matcher[0]}$`);
    for (const p of ["/leads/abc.png", "/campanhas/x.svg", "/sequences/x.txt", "/pipeline.js", "/pipeline", "/leads", "/", "/api/outra", "/favicon.ico.x", "/api/webhooksx", "/api/cronx", "/api/other", "/api/cron-tick", "/api/crons/tick", "/api/integrationsx", "/api/integration", "/api/x/integrations/leads"]) expect(re.test(p), p).toBe(true);
    for (const p of ["/_next/static/x.js", "/favicon.ico", "/file.svg", "/api/webhooks/x", "/api/webhooks/evolution", "/api/cron/tick", "/api/cron", "/api/cron/x/y", "/api/integrations", "/api/integrations/leads"]) expect(re.test(p), p).toBe(false);
    expect((await proxy(req("/leads/abc.png"))).status).toBe(307);
    expect((await proxy(req("/login"))).status).toBe(200);
  });

});

describe("todas as Server Actions chamam requireUser (exceto auth.ts)", () => {
  const dir = path.resolve(__dirname, "../actions");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !["auth.ts", "result.ts"].includes(f));
  it.each(files)("%s", (f) => {
    const src = readFileSync(path.join(dir, f), "utf8");
    const parts = src.split(/^(?=(?:export )?async function )/m).filter((c) => /^(export )?async function /.test(c));
    const fns = parts.map((c) => ({ name: /function (\w+)/.exec(c)![1], exported: c.startsWith("export"), body: c }));
    const ok = (fn: (typeof fns)[number], seen = new Set<string>()): boolean => {
      // SPEC-030/033: requireProviderOrg()/requireActiveProviderOrg()/requirePlatformAdmin() chamam requireUser() por dentro.
      if (/\brequireUser\(\)|\brequireProviderOrg\(\)|\brequireActiveProviderOrg\(\)|\brequirePlatformAdmin\(\)/.test(fn.body)) return true;
      seen.add(fn.name);
      return fns.some((o) => !seen.has(o.name) && new RegExp(`\\b${o.name}\\(`).test(fn.body) && ok(o, seen));
    };
    // SPEC-033: signUpAndStartCheckout (billing.ts) é pública como login/logout (cria a própria sessão) — allowlist pontual, mesmo critério de src/lib/use-server-auth.test.ts.
    const exported = fns.filter((x) => x.exported && !(f === "billing.ts" && x.name === "signUpAndStartCheckout"));
    expect(exported.length).toBeGreaterThan(0);
    for (const fn of exported) expect(ok(fn), `${f}:${fn.name} não chama requireUser`).toBe(true);
  });
});

describe("queries chamam requireUser antes do prisma", () => {
  const dir = path.resolve(__dirname, "../queries");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  it.each(files)("%s", (f) => {
    const src = readFileSync(path.join(dir, f), "utf8");
    const parts = src.split(/^(?=export (?:async )?function )/m).filter((c) => /^export async function /.test(c));
    for (const c of parts) {
      const name = /function (\w+)/.exec(c)![1];
      const body = c.slice(c.indexOf("\n"));
      const iPrisma = body.search(/\bprisma\b|\bget\w+\(/);
      // SPEC-030/033: requireProviderOrg()/requireActiveProviderOrg()/requirePlatformAdmin() chamam requireUser() por dentro (substituem o antigo requireAdmin()).
      const iReq = Math.max(body.indexOf("requireUser()"), body.indexOf("requireAdmin()"), body.indexOf("requireProviderOrg()"), body.indexOf("requireActiveProviderOrg()"), body.indexOf("requirePlatformAdmin()"));
      if (iPrisma === -1 && !/\bprisma\b/.test(c)) continue;
      expect(iReq, `${f}:${name} sem requireUser`).toBeGreaterThan(-1);
      expect(iReq, `${f}:${name} requireUser depois do acesso`).toBeLessThan(iPrisma === -1 ? Infinity : iPrisma);
    }
  });
});
