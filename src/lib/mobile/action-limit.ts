import { redisHit, rlKey, tryRedis } from "@/lib/rate-limit/redis";

/** SPEC-026: rate limit das acoes de gestao POR DISPOSITIVO (em memoria, por processo; mesma limitacao de refresh-limit.ts). */
export const ACTION_MAX = 30;
export const ACTION_WINDOW_MS = 60_000;
export const REAUTH_MAX_FAILURES = 5;
export const REAUTH_WINDOW_MS = 15 * 60_000;

const stores = new Map<string, Map<string, { count: number; resetAt: number }>>();

async function hit(bucket: string, key: string, max: number, windowMs: number, now: number): Promise<number> {
  const w = await redisHit(`mobile-${bucket}`, key, max, windowMs);
  if (w !== undefined) return w ?? 0;
  return hitMem(bucket, key, max, windowMs, now);
}
function hitMem(bucket: string, key: string, max: number, windowMs: number, now: number): number {
  let s = stores.get(bucket);
  if (!s) stores.set(bucket, (s = new Map()));
  const e = s.get(key);
  if (!e || e.resetAt <= now) {
    if (s.size > 10_000) s.clear();
    s.set(key, { count: 1, resetAt: now + windowMs });
    return 0;
  }
  e.count++;
  return e.count > max ? Math.ceil((e.resetAt - now) / 1000) : 0;
}

/** Segundos de espera se estourou, senao 0. */
export const hitActionLimit = (deviceId: string, now = Date.now()): Promise<number> => hit("action", deviceId, ACTION_MAX, ACTION_WINDOW_MS, now);
/** Falhas de senha na reautenticacao: bloqueia depois de REAUTH_MAX_FAILURES (por dispositivo). */
export async function reauthBlockedSeconds(deviceId: string, now = Date.now()): Promise<number> {
  const viaRedis = await tryRedis(async (r) => {
    const [c, ttl] = await Promise.all([r.get(rlKey("mobile-reauth", deviceId)), r.pttl(rlKey("mobile-reauth", deviceId))]);
    return Number(c ?? 0) >= REAUTH_MAX_FAILURES && ttl > 0 ? Math.ceil(ttl / 1000) : 0;
  });
  if (viaRedis !== undefined) return viaRedis;
  const e = stores.get("reauth")?.get(deviceId);
  return e && e.resetAt > now && e.count >= REAUTH_MAX_FAILURES ? Math.ceil((e.resetAt - now) / 1000) : 0;
}
export const recordReauthFailure = async (deviceId: string, now = Date.now()): Promise<void> => void (await hit("reauth", deviceId, REAUTH_MAX_FAILURES, REAUTH_WINDOW_MS, now));
export async function clearReauthFailures(deviceId: string): Promise<void> {
  stores.get("reauth")?.delete(deviceId);
  await tryRedis((r) => r.del(rlKey("mobile-reauth", deviceId)));
}
export function _clearActionLimit(): void {
  stores.clear();
}
