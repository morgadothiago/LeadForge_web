/**
 * Rate limit em memória (por processo) do endpoint público de descadastro.
 * IP confiável (TRUSTED_PROXY_IP_HEADER): 30 req/min por IP + 10 req/min por token.
 * IP "unknown" (sem proxy confiável, IP compartilhado): NÃO limita por IP (bloquearia titulares legítimos entre si);
 * limita por token (10/min, só para token com assinatura válida) e por um teto global generoso (600/min) só contra flood. Descadastro é obrigação legal: na dúvida, aceita.
 */

import { verifyUnsubscribeToken } from "./unsubscribe";

export const RATE_MAX = 30;
export const TOKEN_MAX = 10;
export const GLOBAL_MAX = 600;
export const RATE_WINDOW_MS = 60_000;
/** Teto de chaves no Map (memória limitada). */
export const MAX_KEYS = 10_000;
const SWEEP_EVERY_MS = 10_000;
const FULL_SWEEP_MIN_GAP_MS = 1_000;
const EVICT_SCAN = 100;
const hits = new Map<string, { count: number; resetAt: number; max: number }>();
let lastSweep = 0;

export function _resetUnsubscribeRateLimit(): void {
  hits.clear();
  lastSweep = 0;
}
/** Testes. */
export function _rateLimitSize(): number {
  return hits.size;
}

function sweep(now: number): void {
  lastSweep = now;
  for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
}

/** Abre espaço p/ 1 chave nova: varre expiradas (no máx. 1x/s) e, se ainda lotado, descarta a mais antiga NÃO bloqueada (janela curta). */
function makeRoom(now: number): boolean {
  if (hits.size < MAX_KEYS) return true;
  if (now - lastSweep >= FULL_SWEEP_MIN_GAP_MS) sweep(now);
  if (hits.size < MAX_KEYS) return true;
  let scanned = 0;
  for (const [k, v] of hits) {
    if (v.count <= v.max) {
      hits.delete(k);
      return true;
    }
    if (++scanned >= EVICT_SCAN) break;
  }
  return false; // as mais antigas estão todas bloqueadas: nunca as descartamos (evita bypass)
}

/** Conta 1 hit em `key`. number = segundos de espera (bloqueado); null = ok; "full" = sem espaço p/ nova chave. */
function hit(key: string, max: number, now: number): number | null | "full" {
  const e = hits.get(key);
  if (!e) {
    if (!makeRoom(now)) return "full";
    hits.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS, max });
    return null;
  }
  e.count++;
  return e.count > max ? Math.max(1, Math.ceil((e.resetAt - now) / 1000)) : null;
}

/**
 * Devolve segundos de espera (429) ou null. Limpeza amortizada (a cada 10s, não por requisição).
 * Chave por token só é criada se a assinatura do token é válida (tokens forjados não consomem memória).
 * Lotado sem como descartar: chave de IP nova -> 429 curto (1s); chave de token válido -> aceita sem contar (descadastro é obrigação legal).
 */
export function rateLimitRetrySeconds(ip: string, token?: string | null, now = Date.now()): number | null {
  if (now - lastSweep >= SWEEP_EVERY_MS) sweep(now);
  const waits: (number | null)[] = [];
  const r = ip === "unknown" ? hit("g", GLOBAL_MAX, now) : hit(`ip:${ip}`, RATE_MAX, now);
  if (r === "full") return 1;
  waits.push(r);
  if (token && verifyUnsubscribeToken(token, new Date(now))) {
    const t = hit(`t:${token}`, TOKEN_MAX, now);
    if (t !== "full") waits.push(t);
  }
  const over = waits.filter((w): w is number => w !== null);
  return over.length ? Math.max(...over) : null;
}
