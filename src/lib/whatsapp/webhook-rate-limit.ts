/**
 * Rate limit em memória (por processo) do receiver de webhook do WhatsApp — mesmo padrão de
 * src/lib/channels/unsubscribe-rate-limit.ts, generalizado (janela fixa, teto de chaves, varredura amortizada).
 * Três baldes independentes, para que ruído de tokens inválidos NUNCA consuma a cota do tráfego legítimo:
 *  - invalid: tentativas com token malformado/inexistente (chave única, sem criar chave por token forjado);
 *  - global: todo tráfego de token válido;
 *  - token: por token válido (a chave só nasce depois de o token existir no banco).
 */

export interface Limits {
  windowMs: number;
  invalidMax: number;
  globalMax: number;
  tokenMax: number;
  maxKeys: number;
}
export const DEFAULT_LIMITS: Limits = { windowMs: 60_000, invalidMax: 120, globalMax: 1500, tokenMax: 300, maxKeys: 1000 };
let limits: Limits = { ...DEFAULT_LIMITS };

const hits = new Map<string, { count: number; resetAt: number }>();

/** Testes. */
export function configureWebhookRateLimit(partial: Partial<Limits>): void {
  limits = { ...limits, ...partial };
}
export function _resetWebhookRateLimit(): void {
  hits.clear();
  limits = { ...DEFAULT_LIMITS };
}
export function _webhookRateLimitSize(): number {
  return hits.size;
}

function sweep(now: number): void {
  for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
}

/** segundos de espera (bloqueado) ou null. Sem espaço p/ chave nova: aceita sem contar (webhook legítimo > memória). */
function hit(key: string, max: number, now: number): number | null {
  let e = hits.get(key);
  if (!e || e.resetAt <= now) {
    if (!e && hits.size >= limits.maxKeys) {
      sweep(now);
      if (hits.size >= limits.maxKeys) return null;
    }
    e = { count: 0, resetAt: now + limits.windowMs };
    hits.set(key, e);
  }
  e.count++;
  return e.count > max ? Math.max(1, Math.ceil((e.resetAt - now) / 1000)) : null;
}

export const invalidAttemptRetry = (now = Date.now()): number | null => hit("invalid", limits.invalidMax, now);

/** Global + por token (token JÁ validado no banco). */
export function validTrafficRetry(token: string, now = Date.now()): number | null {
  const g = hit("global", limits.globalMax, now);
  const t = hit(`t:${token}`, limits.tokenMax, now);
  const over = [g, t].filter((w): w is number => w !== null);
  return over.length ? Math.max(...over) : null;
}
