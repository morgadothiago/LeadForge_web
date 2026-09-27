/**
 * Limitador de janela fixa em memória (por processo), mesmo padrão de `lead-ingest/handler.ts` (SPEC-014):
 * tentativas INVÁLIDAS (assinatura/autenticação falhou) usam uma ÚNICA chave global — nunca uma chave por
 * valor forjado (evitaria estourar memória com chaves forjadas em rajada) — e tentativas VÁLIDAS têm teto
 * próprio, mais generoso, pra nunca travar o provedor legítimo por ruído de terceiros.
 */
export interface RateLimitConfig {
  windowMs: number;
  max: number;
}
export interface Bucket {
  count: number;
  resetAt: number;
}

export function hit(b: Bucket, cfg: RateLimitConfig, now = Date.now()): { b: Bucket; wait: number | null } {
  if (b.resetAt <= now) b = { count: 0, resetAt: now + cfg.windowMs };
  b.count++;
  return { b, wait: b.count > cfg.max ? Math.max(1, Math.ceil((b.resetAt - now) / 1000)) : null };
}

export const freshBucket = (): Bucket => ({ count: 0, resetAt: 0 });
