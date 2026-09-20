/** Limite de /auth/refresh por dispositivo: 30 / 15 min, EM MEMÓRIA (limitação: por processo, ver rate-limit.ts). */
const MAX = 30;
const WINDOW_MS = 15 * 60 * 1000;
const store = new Map<string, { count: number; resetAt: number }>();

/** Registra a tentativa; retorna segundos de espera se estourou, senão 0. */
export function hitRefreshLimit(deviceId: string, now = Date.now()): number {
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
