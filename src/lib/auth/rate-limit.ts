/**
 * Rate limit de login EM MEMÓRIA, duas camadas:
 *  1) e-mail+IP: máx. 5 falhas / 15 min;
 *  2) só e-mail (não burlável por rotação de IP): máx. 20 falhas / 15 min.
 * Backoff progressivo (a partir da 3ª falha na chave e-mail+IP e da 10ª só por e-mail): após cada falha a chave
 * fica bloqueada por min(2^(falhas-limiar) s, 60 s) — `retryAfterMs` em isRateLimited. Ao estourar o teto,
 * bloqueia até a janela expirar. Login com sucesso zera as chaves de e-mail+IP e de e-mail.
 * Store limitado: teto duro de MAX_ENTRIES (FIFO — remove a mais antiga) + limpeza de expiradas a cada escrita.
 * LIMITAÇÃO: estado por processo (multi-instância = N x limite; reinicia no deploy). Migrar p/ Redis/tabela se escalar.
 */
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
export function isRateLimited(key: string, emailK?: string, now = Date.now()): boolean {
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

export function recordFailure(key: string, emailK?: string, now = Date.now()): void {
  bump(key, BACKOFF_START_IP, now);
  if (emailK) bump(emailK, BACKOFF_START_EMAIL, now);
  prune(now);
}

export function resetFailures(key: string, emailK?: string): void {
  store.delete(key);
  if (emailK) store.delete(emailK);
}

export function _storeSize(): number {
  return store.size;
}
export function _clearRateLimit(): void {
  store.clear();
}
