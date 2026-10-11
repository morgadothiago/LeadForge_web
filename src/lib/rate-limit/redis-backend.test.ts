import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlidingLimiter } from "@/lib/integrations/rate-limit";
import { _clearRateLimit, emailKey, isRateLimited, loginKey, LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS, recordFailure, resetFailures } from "@/lib/auth/rate-limit";
import { hitActionLimit, ACTION_MAX, _clearActionLimit, recordReauthFailure, reauthBlockedSeconds, clearReauthFailures, REAUTH_MAX_FAILURES } from "@/lib/mobile/action-limit";
import { hitRefreshLimit, _clearRefreshLimit } from "@/lib/mobile/refresh-limit";
import { _resetWebhookRateLimit, invalidAttemptRetry } from "@/lib/whatsapp/webhook-rate-limit";
import { _resetUnsubscribeRateLimit, rateLimitRetrySeconds, RATE_MAX } from "@/lib/channels/unsubscribe-rate-limit";
import { BREAKER_MS, rlKey, _resetRedisClient, _setRedisClient, redisHit, tryRedis } from "./redis";
import { FakeRedis } from "./fake-redis";

let fake: FakeRedis;
beforeEach(() => {
  fake = new FakeRedis();
  _setRedisClient(fake);
  _clearRateLimit();
  _clearActionLimit();
  _clearRefreshLimit();
  _resetWebhookRateLimit();
  _resetUnsubscribeRateLimit();
});
afterEach(() => {
  _resetRedisClient();
  vi.restoreAllMocks();
});

describe("PII fora das chaves Redis (D-059-7)", () => {
  it("nenhuma chave contem e-mail, IP ou token em claro; namespace legivel", async () => {
    const l = new SlidingLimiter(2, 1000, 1000, "pii");
    await l.hit("alice@example.com", 0);
    await redisHit("pii-fw", "203.0.113.9", 5, 1000);
    await redisHit("pii-fw", "tok_SECRETTOKEN123", 5, 1000);
    await redisHit("pii-fw", "org1:bob@example.com", 5, 1000);
    const keys = fake.keys();
    expect(keys.length).toBe(4);
    for (const k of keys) {
      expect(k).toMatch(/^lf:rl:pii(-fw)?:[0-9a-f]{32}$/);
      expect(k).not.toMatch(/alice|bob|example|203\.0\.113|SECRETTOKEN/);
    }
  });
});

describe("SlidingLimiter via Redis", () => {
  it("respeita max/janela, peek nao registra e o estado e compartilhado entre instancias", async () => {
    const a = new SlidingLimiter(2, 1000, 1000, "t1");
    const b = new SlidingLimiter(2, 1000, 1000, "t1"); // "outra instancia"
    expect(await a.peek("k", 0)).toBe(0);
    expect(await a.hit("k", 0)).toBe(0);
    expect(await b.hit("k", 10)).toBe(0);
    expect(await a.hit("k", 20)).toBe(1); // ceil(980ms)
    expect(await b.peek("k", 20)).toBe(1);
    expect(await a.hit("k", 1001)).toBe(0); // janela passou para a 1a tentativa
    expect(fake.keys().every((k) => k.startsWith("lf:rl:t1:"))).toBe(true);
  });
  it("namespaces distintos nao colidem", async () => {
    const a = new SlidingLimiter(1, 1000, 1000, "n1");
    const b = new SlidingLimiter(1, 1000, 1000, "n2");
    expect(await a.hit("k", 0)).toBe(0);
    expect(await b.hit("k", 0)).toBe(0);
    expect(await a.hit("k", 1)).toBeGreaterThan(0);
  });
  it("atomicidade: N hits concorrentes liberam exatamente max", async () => {
    const l = new SlidingLimiter(5, 60_000, 1000, "conc");
    const r = await Promise.all(Array.from({ length: 20 }, () => l.hit("k", 100)));
    expect(r.filter((x) => x === 0)).toHaveLength(5);
  });
  it("chave tem TTL", async () => {
    const l = new SlidingLimiter(5, 60_000, 1000, "ttl");
    await l.hit("k");
    expect(fake.ttlOf(rlKey("ttl", "k"))).toBeGreaterThan(0);
  });
});

describe("janela fixa via Redis", () => {
  it("max, retry=ttl, expira, e concorrencia conta exatamente N", async () => {
    const res = await Promise.all(Array.from({ length: 12 }, () => redisHit("fw", "k", 10, 60_000)));
    expect(res.filter((x) => x === null)).toHaveLength(10);
    expect(res.filter((x) => typeof x === "number")).toHaveLength(2);
    expect(res.find((x) => typeof x === "number")).toBeLessThanOrEqual(60);
    expect(fake.ttlOf(rlKey("fw", "k"))).toBeGreaterThan(0);
    fake.clock = () => Date.now() + 61_000;
    expect(await redisHit("fw", "k", 10, 60_000)).toBeNull(); // janela nova
  });
  it("mobile action/refresh/webhook/unsubscribe usam Redis (compartilhado)", async () => {
    for (let i = 0; i < ACTION_MAX; i++) expect(await hitActionLimit("d")).toBe(0);
    expect(await hitActionLimit("d")).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) expect(await hitRefreshLimit("d")).toBe(0);
    expect(await hitRefreshLimit("d")).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) await invalidAttemptRetry();
    expect(await invalidAttemptRetry()).toBeGreaterThan(0);
    for (let i = 0; i < RATE_MAX; i++) expect(await rateLimitRetrySeconds("9.9.9.9", null)).toBeNull();
    expect(await rateLimitRetrySeconds("9.9.9.9", null)).toBeGreaterThan(0);
    expect(fake.keys().every((k) => k.startsWith("lf:rl:"))).toBe(true);
  });
  it("reauth: bloqueia apos N falhas e clear libera", async () => {
    for (let i = 0; i < REAUTH_MAX_FAILURES; i++) await recordReauthFailure("dev");
    expect(await reauthBlockedSeconds("dev")).toBeGreaterThan(0);
    await clearReauthFailures("dev");
    expect(await reauthBlockedSeconds("dev")).toBe(0);
  });
});

describe("login via Redis", () => {
  it("teto, backoff, camada por e-mail e reset", async () => {
    const k = loginKey("a@x.com", "1.1.1.1");
    const ek = emailKey("a@x.com");
    const now = Date.now();
    for (let i = 0; i < 3; i++) await recordFailure(k, ek, now);
    expect(await isRateLimited(k, ek, now)).toBe(true); // backoff da 3a falha
    expect(await isRateLimited(k, ek, now + 3000)).toBe(false);
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await recordFailure(k, ek, now);
    expect(await isRateLimited(k, ek, now + LOGIN_WINDOW_MS - 1000)).toBe(true);
    await resetFailures(k, ek);
    expect(await isRateLimited(k, ek, now)).toBe(false);
    expect(fake.keys()).toEqual([]);
  });
  it("estado compartilhado: limitado visto por 'outro processo' (memoria limpa)", async () => {
    const k = loginKey("b@x.com", "2.2.2.2");
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await recordFailure(k, undefined, 1000);
    _clearRateLimit(); // memoria do processo vazia
    expect(await isRateLimited(k, undefined, 1000)).toBe(true);
  });
});

describe("fallback e fail-open", () => {
  it("sem REDIS_URL: usa memoria e nunca toca no Redis", async () => {
    _setRedisClient(null);
    const l = new SlidingLimiter(1, 1000, 1000, "mem");
    expect(await l.hit("k", 0)).toBe(0);
    expect(await l.hit("k", 1)).toBeGreaterThan(0);
    expect(fake.evalCalls).toBe(0);
  });
  it("REDIS_URL ausente no ambiente => cliente null", async () => {
    _resetRedisClient();
    const prev = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    expect(await redisHit("x", "y", 1, 1000)).toBeUndefined();
    if (prev !== undefined) process.env.REDIS_URL = prev;
  });
  it("Redis cai: nao lanca, degrada para memoria (ainda limita) e reabre o circuito apos BREAKER_MS", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fake.failing = true;
    const l = new SlidingLimiter(2, 60_000, 1000, "down");
    expect(await l.hit("k", 0)).toBe(0);
    expect(await l.hit("k", 1)).toBe(0);
    expect(await l.hit("k", 2)).toBeGreaterThan(0); // memoria segue limitando
    expect(warn).toHaveBeenCalledTimes(1); // log throttled
    const calls = fake.evalCalls;
    fake.failing = false;
    expect(await redisHit("x", "k", 5, 1000)).toBeUndefined(); // circuito aberto: nem tenta
    expect(fake.evalCalls).toBe(calls);
    vi.useFakeTimers({ now: Date.now() + BREAKER_MS + 1 });
    expect(await redisHit("x", "k", 5, 1000)).toBeNull(); // voltou
    vi.useRealTimers();
  });
  it("login com Redis fora: continua protegendo em memoria", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fake.failing = true;
    const k = loginKey("c@x.com", "3.3.3.3");
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await recordFailure(k, undefined, 1000);
    expect(await isRateLimited(k, undefined, 1000)).toBe(true);
  });
});

describe("conexao ainda subindo (achado E2E, SPEC-059)", () => {
  it("status connecting/wait: usa memoria SEM abrir o circuito; ao ficar ready usa o Redis na hora", async () => {
    const f = new FakeRedis();
    const spy = vi.spyOn(f, "eval");
    f.status = "connecting";
    _setRedisClient(f);
    const t0 = Date.now();
    expect(await tryRedis(async (r) => r.eval("return 1", 0))).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(500); // sem promessa de conexao pendente, nao espera
    expect(spy).not.toHaveBeenCalled();
    f.status = "ready";
    await tryRedis(async (r) => r.eval("return 1", 0));
    expect(spy).toHaveBeenCalledTimes(1); // sem BREAKER_MS de espera
  });
});
