/** SPEC-026: rate limit das acoes de gestao POR DISPOSITIVO (em memoria, por processo; mesma limitacao de refresh-limit.ts). */
export const ACTION_MAX = 30;
export const ACTION_WINDOW_MS = 60_000;
export const REAUTH_MAX_FAILURES = 5;
export const REAUTH_WINDOW_MS = 15 * 60_000;

const stores = new Map<string, Map<string, { count: number; resetAt: number }>>();

function hit(bucket: string, key: string, max: number, windowMs: number, now: number): number {
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
export const hitActionLimit = (deviceId: string, now = Date.now()) => hit("action", deviceId, ACTION_MAX, ACTION_WINDOW_MS, now);
/** Falhas de senha na reautenticacao: bloqueia depois de REAUTH_MAX_FAILURES (por dispositivo). */
export function reauthBlockedSeconds(deviceId: string, now = Date.now()): number {
  const e = stores.get("reauth")?.get(deviceId);
  return e && e.resetAt > now && e.count >= REAUTH_MAX_FAILURES ? Math.ceil((e.resetAt - now) / 1000) : 0;
}
export const recordReauthFailure = (deviceId: string, now = Date.now()) => void hit("reauth", deviceId, REAUTH_MAX_FAILURES, REAUTH_WINDOW_MS, now);
export function clearReauthFailures(deviceId: string): void {
  stores.get("reauth")?.delete(deviceId);
}
export function _clearActionLimit(): void {
  stores.clear();
}
