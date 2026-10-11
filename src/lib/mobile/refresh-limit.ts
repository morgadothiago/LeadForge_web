import { redisHit } from "@/lib/rate-limit/redis";

/** Limite de /auth/refresh por dispositivo: 30 / 15 min, (SPEC-059: Redis com REDIS_URL; senão memória por processo). */
const MAX = 30;
const WINDOW_MS = 15 * 60 * 1000;
const store = new Map<string, { count: number; resetAt: number }>();

/** Registra a tentativa; retorna segundos de espera se estourou, senão 0. */
export async function hitRefreshLimit(deviceId: string, now = Date.now()): Promise<number> {
  const w = await redisHit("mobile-refresh", deviceId, MAX, WINDOW_MS);
  if (w !== undefined) return w ?? 0;
  const e = store.get(deviceId);
  if (!e || e.resetAt <= now) {
    if (store.size > 10_000) store.clear();
    store.set(deviceId, { count: 1, resetAt: now + WINDOW_MS });
    return 0;
  }
  e.count++;
  return e.count > MAX ? Math.ceil((e.resetAt - now) / 1000) : 0;
}
export function _clearRefreshLimit(): void {
  store.clear();
}
