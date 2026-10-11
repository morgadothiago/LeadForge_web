import { randomUUID } from "node:crypto";
import { SLIDING_LUA, rlKey, tryRedis } from "@/lib/rate-limit/redis";

/**
 * SPEC-059: com REDIS_URL o estado é compartilhado (sorted set + Lua atômico, chaves `lf:rl:<name>:<key>`); sem Redis (ou com
 * ele fora do ar) cai para a memória do processo.
 * Limitador de janela deslizante em memória (por processo) com teto de chaves e limpeza (SPEC-018 QA B1/M3).
 * `hit` devolve segundos até liberar (0 = liberado; registra a tentativa).
 */
export class SlidingLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly max: number, private readonly windowMs: number, private readonly maxKeys = 1000, private readonly name = "sliding") {}

  private sweep(now: number): void {
    for (const [k, v] of this.hits) {
      const recent = v.filter((t) => now - t < this.windowMs);
      if (recent.length) this.hits.set(k, recent);
      else this.hits.delete(k);
    }
  }

  private async viaRedis(key: string, now: number, record: boolean): Promise<number | undefined> {
    const ms = await tryRedis((r) => r.eval(SLIDING_LUA, 1, rlKey(this.name, key), now, this.windowMs, this.max, randomUUID(), record ? 1 : 0));
    return ms === undefined ? undefined : Math.ceil(Number(ms) / 1000);
  }

  /** Só consulta (não registra). */
  async peek(key: string, now = Date.now()): Promise<number> {
    return (await this.viaRedis(key, now, false)) ?? this.peekMem(key, now);
  }

  /** Registra a tentativa; devolve segundos até liberar (0 = liberado). */
  async hit(key: string, now = Date.now()): Promise<number> {
    return (await this.viaRedis(key, now, true)) ?? this.hitMem(key, now);
  }

  private peekMem(key: string, now: number): number {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    return recent.length >= this.max ? Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 1000)) : 0;
  }

  private hitMem(key: string, now: number): number {
    if (!this.hits.has(key) && this.hits.size >= this.maxKeys) {
      this.sweep(now);
      // ainda cheio (rajada de chaves distintas): descarta a mais antiga (FIFO do Map) para manter o teto.
      while (this.hits.size >= this.maxKeys) {
        const first = this.hits.keys().next().value;
        if (first === undefined) break;
        this.hits.delete(first);
      }
    }
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 1000));
    }
    recent.push(now);
    this.hits.set(key, recent);
    return 0;
  }

  get size(): number {
    return this.hits.size;
  }
  clear(): void {
    this.hits.clear();
  }
}
