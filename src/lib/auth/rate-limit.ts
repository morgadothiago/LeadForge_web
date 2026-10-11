/**
 * Rate limit de login EM MEMÓRIA, duas camadas:
 *  1) e-mail+IP: máx. 5 falhas / 15 min;
 *  2) só e-mail (não burlável por rotação de IP): máx. 20 falhas / 15 min.
 * Backoff progressivo (a partir da 3ª falha na chave e-mail+IP e da 10ª só por e-mail): após cada falha a chave
 * fica bloqueada por min(2^(falhas-limiar) s, 60 s) — `retryAfterMs` em isRateLimited. Ao estourar o teto,
 * bloqueia até a janela expirar. Login com sucesso zera as chaves de e-mail+IP e de e-mail.
 * Store limitado: teto duro de MAX_ENTRIES (FIFO — remove a mais antiga) + limpeza de expiradas a cada escrita.
 * SPEC-059: com REDIS_URL o estado é compartilhado (hash por chave + Lua atômico, `lf:rl:login:*`); sem Redis, ou com ele
 * fora do ar, usa a memória do processo (limitação anterior: multi-instância = N x limite).
 */
import { LOGIN_BUMP_LUA, rlKey, tryRedis } from "@/lib/rate-limit/redis";

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_MAX_FAILURES_PER_EMAIL = 20;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const MAX_ENTRIES = 10_000;
const BACKOFF_START_IP = 2; // falhas já registradas a partir das quais começa o atraso
const BACKOFF_START_EMAIL = 9;
const BACKOFF_MAX_MS = 60_000;

interface Entry { count: number; resetAt: number; blockedUntil: number }
const store = new Map<string, Entry>(); // Map preserva ordem de inserção (FIFO)

export function loginKey(email: string, ip: string): string {
  return `${email.toLowerCase()}|${ip}`;
}
export function emailKey(email: string): string {
  return `email:${email.toLowerCase()}`;
}

function limited(key: string, max: number, now: number): boolean {
  const e = store.get(key);
  if (!e) return false;
  if (e.resetAt <= now) { store.delete(key); return false; }
  return e.count >= max || e.blockedUntil > now;
}

/** Bloqueado se qualquer camada estourou o teto ou está em backoff. */
export async function isRateLimited(key: string, emailK?: string, now = Date.now()): Promise<boolean> {
  const viaRedis = await tryRedis(async (r) => {
    const rows = await Promise.all([
      r.hmget(rlKey("login", key), "count", "blockedUntil"),
      emailK !== undefined ? r.hmget(rlKey("login", emailK), "count", "blockedUntil") : Promise.resolve(null),
    ]);
    const over = (row: (string | null)[] | null, max: number) => row !== null && (Number(row[0] ?? 0) >= max || Number(row[1] ?? 0) > now);
    return over(rows[0], LOGIN_MAX_FAILURES) || over(rows[1], LOGIN_MAX_FAILURES_PER_EMAIL);
  });
  if (viaRedis !== undefined) return viaRedis;
  return limited(key, LOGIN_MAX_FAILURES, now) || (emailK !== undefined && limited(emailK, LOGIN_MAX_FAILURES_PER_EMAIL, now));
}

function bump(key: string, backoffStart: number, now: number): void {
  const e = store.get(key);
  if (!e || e.resetAt <= now) {
    store.delete(key);
    store.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS, blockedUntil: 0 });
  } else {
    e.count++;
    if (e.count > backoffStart) e.blockedUntil = now + Math.min(2 ** (e.count - backoffStart) * 1000, BACKOFF_MAX_MS);
  }
}

function prune(now: number): void {
  for (const [k, v] of store) if (v.resetAt <= now) store.delete(k);
  while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value as string);
}

export async function recordFailure(key: string, emailK?: string, now = Date.now()): Promise<void> {
  const bumpRedis = (k: string, start: number) =>
    tryRedis((r) => r.eval(LOGIN_BUMP_LUA, 1, rlKey("login", k), now, LOGIN_WINDOW_MS, start, BACKOFF_MAX_MS));
  const done = await Promise.all([bumpRedis(key, BACKOFF_START_IP), emailK ? bumpRedis(emailK, BACKOFF_START_EMAIL) : Promise.resolve(0)]);
  if (done[0] !== undefined && done[1] !== undefined) return;
  // Redis indisponível: registra na memória do processo (degradação, D-059-3).
  bump(key, BACKOFF_START_IP, now);
  if (emailK) bump(emailK, BACKOFF_START_EMAIL, now);
  prune(now);
}

export async function resetFailures(key: string, emailK?: string): Promise<void> {
  store.delete(key);
  if (emailK) store.delete(emailK);
  await tryRedis((r) => r.del(...[key, emailK].filter((k): k is string => !!k).map((k) => rlKey("login", k))));
}

export function _storeSize(): number {
  return store.size;
}
export function _clearRateLimit(): void {
  store.clear();
}
