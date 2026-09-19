import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
import { getCookie, signInAs, signOut, testHeaders } from "./test-helpers";
import { login, logout } from "@/lib/actions/auth";
import { seedAdmin } from "../../../prisma/seed";
import { proxy } from "@/proxy";
import { NextRequest } from "next/server";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const EMAIL = "zz-test-auth@leadforge.local";
const PASS = "Senha-Forte-Teste-123";
let userId = "";

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz-test-auth" } } });
  const u = await prisma.user.create({ data: { name: "T", email: EMAIL, passwordHash: await hashPassword(PASS) } });
  userId = u.id;
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz-test-auth" } } });
  await prisma.$disconnect();
});
beforeEach(() => {
  signOut();
  _clearRateLimit();
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
    expect(await verifySessionToken(await signSessionToken("u1"))).toEqual({ userId: "u1" });
  });
  it("expirado", async () => {
    const t = await signSessionToken("u1", { now: new Date(Date.now() - 10_000), ttlSeconds: 1 });
    expect(await verifySessionToken(t)).toBeNull();
  });
  it("adulterado / segredo diferente / ausente", async () => {
    const t = await signSessionToken("u1");
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
    expect(await verifySessionToken(await signSessionToken("u", { secret: "z".repeat(48) }))).toBeNull();
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
  it("expõe o role do usuário (admin por padrão, member quando definido)", async () => {
    await signInAs(userId);
    expect((await requireUser()).role).toBe("admin");
    await prisma.user.update({ where: { id: userId }, data: { role: "member" } });
    expect((await requireUser()).role).toBe("member");
  });
  it("usuário removido -> UnauthorizedError", async () => {
    await signInAs("00000000-0000-4000-8000-00000000dead");
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
  it("token inválido redireciona; válido passa; /login passa", async () => {
    expect((await proxy(req("/", "lixo"))).status).toBe(307);
    expect((await proxy(req("/", await signSessionToken("u")))).headers.get("location")).toBeNull();
    expect((await proxy(req("/login"))).headers.get("location")).toBeNull();
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
      if (/\brequireUser\(\)/.test(fn.body)) return true;
      seen.add(fn.name);
      return fns.some((o) => !seen.has(o.name) && new RegExp(`\\b${o.name}\\(`).test(fn.body) && ok(o, seen));
    };
    const exported = fns.filter((x) => x.exported);
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
      const iReq = body.indexOf("requireUser()");
      if (iPrisma === -1 && !/\bprisma\b/.test(c)) continue;
      expect(iReq, `${f}:${name} sem requireUser`).toBeGreaterThan(-1);
      expect(iReq, `${f}:${name} requireUser depois do acesso`).toBeLessThan(iPrisma === -1 ? Infinity : iPrisma);
    }
  });
});
