import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Redis from "ioredis";
import { SlidingLimiter } from "@/lib/integrations/rate-limit";
import { _clearRateLimit, emailKey, isRateLimited, loginKey, LOGIN_MAX_FAILURES, recordFailure, resetFailures } from "@/lib/auth/rate-limit";
import { rlKey, _resetRedisClient, _setRedisClient, redisHit, type RedisLike } from "./redis";

// Integracao CONDICIONAL (SPEC-059 AC-8): so roda se houver Redis em REDIS_TEST_URL (padrao redis://localhost:6379).
const url = process.env.REDIS_TEST_URL ?? "redis://localhost:6379";
let real: Redis | null = null;
let available = false;

beforeAll(async () => {
  const r = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null, connectTimeout: 500, enableOfflineQueue: false });
  r.on("error", () => undefined);
  try {
    await r.connect();
    await r.ping();
    real = r;
    available = true;
    _setRedisClient(r as unknown as RedisLike);
  } catch {
    r.disconnect();
  }
});
const loginKeys: string[] = [];
afterAll(async () => {
  if (real) {
    const keys = await real.keys("lf:rl:itest*");
    const login = loginKeys.map((k) => rlKey("login", k));
    if (keys.length || login.length) await real.del(...keys, ...login);
    real.disconnect();
  }
  _resetRedisClient();
});

describe("Redis real (condicional)", () => {
  it("Lua: janela fixa, sliding e login atomicos", async (ctx) => {
    if (!available) return ctx.skip();
    const id = `${Date.now()}`;
    const fw = await Promise.all(Array.from({ length: 12 }, () => redisHit(`itest-fw${id}`, "k", 10, 5000)));
    expect(fw.filter((x) => x === null)).toHaveLength(10);
    const ttl = await real!.pttl(rlKey(`itest-fw${id}`, "k"));
    expect(ttl).toBeGreaterThan(0);

    const l = new SlidingLimiter(3, 5000, 1000, `itest-sl${id}`);
    const sl = await Promise.all(Array.from({ length: 8 }, () => l.hit("k")));
    expect(sl.filter((x) => x === 0)).toHaveLength(3);
    expect(await l.peek("k")).toBeGreaterThan(0);

    _clearRateLimit();
    const k = loginKey(`itest${id}@x.com`, "1.1.1.1");
    const ek = emailKey(`itest${id}@x.com`);
    loginKeys.push(k, ek);
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await recordFailure(k, ek);
    expect(await isRateLimited(k, ek)).toBe(true);
    await resetFailures(k, ek);
    expect(await isRateLimited(k, ek)).toBe(false);
  });
});
