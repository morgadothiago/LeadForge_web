import "dotenv/config";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { _clearRateLimit } from "@/lib/auth/rate-limit";
import { signSessionToken, verifySessionToken } from "@/lib/auth/session-token";
import { _clearRefreshLimit } from "./refresh-limit";
import { proxy, config } from "@/proxy";
import { NextRequest } from "next/server";
import { spec } from "@/lib/openapi";
import { hashRefresh, signAccessToken } from "./token";
import { POST as login } from "@/app/api/mobile/v1/auth/login/route";
import { POST as refresh } from "@/app/api/mobile/v1/auth/refresh/route";
import { POST as logout } from "@/app/api/mobile/v1/auth/logout/route";
import { GET as me } from "@/app/api/mobile/v1/auth/me/route";
import { GET as devices } from "@/app/api/mobile/v1/devices/route";
import { DELETE as delDevice } from "@/app/api/mobile/v1/devices/[id]/route";

const EMAIL = "zz-test-mobile@leadforge.local";
const PASS = "Senha-Forte-Teste-123";
let userId = "";

const post = (body: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const authed = (token: string, method = "GET", url = "http://x/api") => new Request(url, { method, headers: { authorization: `Bearer ${token}` } });
const loginBody = (over: object = {}) => ({ email: EMAIL, password: PASS, deviceName: "iPhone teste", platform: "ios", ...over });
async function doLogin() {
  const r = await login(post(loginBody()));
  return (await r.json()).data as { accessToken: string; refreshToken: string; deviceId: string; expiresIn: number };
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  userId = (await prisma.user.create({ data: { name: "T", email: EMAIL, passwordHash: await hashPassword(PASS) } })).id;
});
beforeEach(async () => {
  _clearRateLimit();
  _clearRefreshLimit();
  await prisma.mobileDevice.deleteMany({ where: { userId } });
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await prisma.mobileDevice.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
});

describe("login", () => {
  it("AC1: valido devolve access 15min + refresh e cria MobileDevice; nunca grava o token bruto (AC9)", async () => {
    const t = await doLogin();
    expect(t.expiresIn).toBe(900);
    const d = await prisma.mobileDevice.findUniqueOrThrow({ where: { id: t.deviceId } });
    expect(d.refreshHash).toBe(hashRefresh(t.refreshToken));
    expect(JSON.stringify(d)).not.toContain(t.refreshToken);
    expect(d.refreshHash).not.toBe(t.refreshToken);
    const payload = JSON.parse(Buffer.from(t.accessToken.split(".")[1], "base64url").toString());
    expect(payload.aud).toBe("mobile");
    expect(payload.exp - payload.iat).toBe(900);
  });
  it("AC1: invalido = 401 generico (email inexistente igual a senha errada)", async () => {
    const a = await login(post(loginBody({ password: "errada" })));
    const b = await login(post(loginBody({ email: "nao@existe.com" })));
    expect(a.status).toBe(401);
    expect(await a.json()).toEqual(await b.json());
  });
  it("AC1: 6a tentativa errada = 429 com Retry-After", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    let last: Response | undefined;
    for (let i = 0; i < 5; i++) {
      last = await login(post(loginBody({ password: "errada" })));
      expect(last.status).toBe(401);
      vi.setSystemTime(Date.now() + 61_000);
    }
    last = await login(post(loginBody({ password: "errada" })));
    expect(last.status).toBe(429);
    expect(Number(last.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
  it("entrada invalida = 400", async () => {
    expect((await login(post({ email: "x" }))).status).toBe(400);
  });
});

describe("refresh", () => {
  it("AC2: rotaciona; o refresh antigo e o novo par funcionam conforme esperado; reuso revoga o dispositivo", async () => {
    const t = await doLogin();
    const r1 = await refresh(post({ deviceId: t.deviceId, refreshToken: t.refreshToken }));
    expect(r1.status).toBe(200);
    const n = (await r1.json()).data;
    expect(n.refreshToken).not.toBe(t.refreshToken);
    expect((await me(authed(n.accessToken))).status).toBe(200);
    // reuso do antigo
    expect((await refresh(post({ deviceId: t.deviceId, refreshToken: t.refreshToken }))).status).toBe(401);
    // dispositivo revogado: novo refresh e access param
    expect((await refresh(post({ deviceId: t.deviceId, refreshToken: n.refreshToken }))).status).toBe(401);
    expect((await me(authed(n.accessToken))).status).toBe(401);
    expect((await prisma.mobileDevice.findUniqueOrThrow({ where: { id: t.deviceId } })).revokedAt).not.toBeNull();
  });
  it("refresh expirado (30d deslizante) = 401; refresh valido estende a janela", async () => {
    const t = await doLogin();
    await prisma.mobileDevice.update({ where: { id: t.deviceId }, data: { refreshExpiresAt: new Date(Date.now() - 1000) } });
    expect((await refresh(post({ deviceId: t.deviceId, refreshToken: t.refreshToken }))).status).toBe(401);
    const t2 = await doLogin();
    await prisma.mobileDevice.update({ where: { id: t2.deviceId }, data: { refreshExpiresAt: new Date(Date.now() + 1000) } });
    await refresh(post({ deviceId: t2.deviceId, refreshToken: t2.refreshToken }));
    const d = await prisma.mobileDevice.findUniqueOrThrow({ where: { id: t2.deviceId } });
    expect(d.refreshExpiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86400_000);
  });
  it("rate limit por dispositivo: 31a = 429 com Retry-After", async () => {
    const id = crypto.randomUUID();
    let r: Response | undefined;
    for (let i = 0; i < 31; i++) r = await refresh(post({ deviceId: id, refreshToken: "x".repeat(43) }));
    expect(r!.status).toBe(429);
    expect(r!.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("access / guard", () => {
  it("AC2: access expirado = 401 token_expired", async () => {
    const t = await doLogin();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 16 * 60_000);
    const r = await me(authed(t.accessToken));
    expect(r.status).toBe(401);
    expect((await r.json()).error.code).toBe("token_expired");
  });
  it("AC3: logout revoga access e refresh imediatamente", async () => {
    const t = await doLogin();
    expect((await logout(authed(t.accessToken, "POST"))).status).toBe(200);
    expect((await me(authed(t.accessToken))).status).toBe(401);
    expect((await refresh(post({ deviceId: t.deviceId, refreshToken: t.refreshToken }))).status).toBe(401);
  });
  it("AC4: JWT web (cookie) rejeitado no mobile; access mobile rejeitado no web; aud errada rejeitada", async () => {
    const web = await signSessionToken(userId, null, "provider");
    expect((await me(authed(web))).status).toBe(401);
    const t = await doLogin();
    expect(await verifySessionToken(t.accessToken)).toBeNull();
    const req = new NextRequest("http://x/leads", { headers: { cookie: `lf_session=${t.accessToken}` } });
    expect((await proxy(req)).status).toBe(307);
    // mesmo segredo web + did, mas sem aud mobile
    const forged = await new SignJWT({ did: t.deviceId }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setExpirationTime("15m").sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
    expect((await me(authed(forged))).status).toBe(401);
    // web nao aceita Bearer (sem cookie => redirect)
    expect((await proxy(new NextRequest("http://x/leads", { headers: { authorization: `Bearer ${web}` } }))).status).toBe(307);
  });
  it("AC5: sem Bearer = 401 JSON; matcher do proxy nao intercepta /api/mobile/v1", async () => {
    const r = await me(new Request("http://x/api"));
    expect(r.status).toBe(401);
    expect(r.headers.get("content-type")).toContain("json");
    expect(r.headers.get("location")).toBeNull();
    const re = new RegExp(`^${config.matcher[0]}$`);
    expect(re.test("/api/mobile/v1/auth/me")).toBe(false);
    expect(re.test("/api/mobile/v10")).toBe(true);
    expect(re.test("/leads")).toBe(true);
  });
  it("access de dispositivo inexistente = 401", async () => {
    expect((await me(authed(await signAccessToken(userId, crypto.randomUUID())))).status).toBe(401);
  });
});

describe("devices + paginacao", () => {
  it("AC6: 120 registros, sem duplicar/pular; limit>50 vira 50; cursor invalido = 400", async () => {
    const t = await doLogin();
    await prisma.mobileDevice.createMany({
      data: Array.from({ length: 119 }, (_, i) => ({ userId, name: `d${i}`, platform: "android", refreshHash: `h${i}-${crypto.randomUUID()}`, refreshExpiresAt: new Date(Date.now() + 1e9) })),
    });
    const big = await (await devices(authed(t.accessToken, "GET", "http://x/api?limit=999"))).json();
    expect(big.data).toHaveLength(50);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `http://x/api?limit=25${cursor ? `&cursor=${cursor}` : ""}`;
      const j = await (await devices(authed(t.accessToken, "GET", url))).json();
      seen.push(...j.data.map((d: { id: string }) => d.id));
      cursor = j.meta.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
    expect((await devices(authed(t.accessToken, "GET", "http://x/api?cursor=lixo"))).status).toBe(400);
    expect((await devices(authed(t.accessToken, "GET", "http://x/api?limit=0"))).status).toBe(400);
  });
  it("DELETE revoga outro dispositivo do proprio usuario; 404 para inexistente", async () => {
    const a = await doLogin();
    const b = await doLogin();
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
    expect((await delDevice(authed(a.accessToken, "DELETE"), ctx(b.deviceId))).status).toBe(200);
    expect((await me(authed(b.accessToken))).status).toBe(401);
    expect((await delDevice(authed(a.accessToken, "DELETE"), ctx(crypto.randomUUID()))).status).toBe(404);
  });
});

const FORBIDDEN = ["passwordHash", "refreshHash", "prevRefreshHash", "apiKey", "webhookToken", "phone", "telefone", "email", "pushToken"];
function keysOf(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.push(k); keysOf(x, out); }
  return out;
}
type Schema = { $ref?: string; type?: string | string[]; properties?: Record<string, Schema>; required?: string[]; items?: Schema };
function conforms(schema: Schema, value: unknown, path = "$"): string[] {
  if (schema.$ref) return conforms((spec.components!.schemas as Record<string, Schema>)[schema.$ref.split("/").pop()!], value, path);
  if (schema.properties && value && typeof value === "object" && !Array.isArray(value)) {
    const errs: string[] = [];
    for (const r of schema.required ?? []) if (!(r in value)) errs.push(`${path}.${r} ausente`);
    for (const [k, v] of Object.entries(value)) {
      if (!schema.properties[k]) errs.push(`${path}.${k} nao documentado`);
      else errs.push(...conforms(schema.properties[k], v, `${path}.${k}`));
    }
    return errs;
  }
  if (schema.type === "array" && Array.isArray(value) && schema.items) return value.flatMap((x, i) => conforms(schema.items!, x, `${path}[${i}]`));
  return [];
}

describe("AC7 varredura + AC8 contrato OpenAPI", () => {
  it("nenhuma resposta contem chave proibida e todas conformam ao OpenAPI", async () => {
    const t = await doLogin();
    const second = await doLogin();
    const cases: [string, string, Response][] = [
      ["/auth/login", "post", await login(post(loginBody()))],
      ["/auth/refresh", "post", await refresh(post({ deviceId: t.deviceId, refreshToken: t.refreshToken }))],
      ["/auth/me", "get", await me(authed(second.accessToken))],
      ["/devices", "get", await devices(authed(second.accessToken))],
      ["/devices/{id}", "delete", await delDevice(authed(second.accessToken, "DELETE"), { params: Promise.resolve({ id: t.deviceId }) })],
      ["/auth/logout", "post", await logout(authed(second.accessToken, "POST"))],
      ["/auth/me", "get", await me(new Request("http://x/api"))],
    ];
    for (const [path, method, res] of cases) {
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await res.json();
      expect(keysOf(body).filter((k) => FORBIDDEN.includes(k)), `${method} ${path}`).toEqual([]);
      const op = (spec.paths as Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema: Schema }> }> }>>)[path][method];
      const doc = op.responses[String(res.status)];
      expect(doc, `${method} ${path} ${res.status} documentado`).toBeDefined();
      expect(conforms(doc.content!["application/json"].schema, body), `${method} ${path}`).toEqual([]);
    }
  });
  it("OpenAPI: contrato mobile + (SPEC-028) rotas de sessao/webhook declaradas por path e nada de campos internos", () => {
    const s = JSON.stringify(spec);
    for (const k of ["passwordHash", "refreshHash", "apiKey", "webhookToken", "/api/actions"]) expect(s).not.toContain(k);
    expect(Object.keys(spec.paths!).length).toBeGreaterThanOrEqual(15);
  });
});
