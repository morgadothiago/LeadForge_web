import { FIXED_WINDOW_LUA, LOGIN_BUMP_LUA, SLIDING_LUA, type RedisLike } from "./redis";

/**
 * Fake em memoria de RedisLike (SPEC-059, so testes). `eval` reconhece o script pelo texto e executa o equivalente JS de forma
 * sincrona dentro de uma unica chamada (como o Redis, que serializa EVAL) — o teste de integracao real valida o Lua.
 */
export class FakeRedis implements RedisLike {
  strings = new Map<string, number>();
  hashes = new Map<string, Record<string, string>>();
  zsets = new Map<string, { score: number; member: string }[]>();
  expiry = new Map<string, number>();
  failing = false;
  evalCalls = 0;
  clock = () => Date.now();

  private guard(): void {
    if (this.failing) throw new Error("ECONNREFUSED");
  }
  private expire(key: string): void {
    const e = this.expiry.get(key);
    if (e !== undefined && e <= this.clock()) {
      this.strings.delete(key);
      this.hashes.delete(key);
      this.zsets.delete(key);
      this.expiry.delete(key);
    }
  }
  keys(): string[] {
    for (const k of [...this.expiry.keys()]) this.expire(k);
    return [...this.strings.keys(), ...this.hashes.keys(), ...this.zsets.keys()];
  }
  ttlOf(key: string): number {
    this.expire(key);
    const e = this.expiry.get(key);
    return e === undefined ? -1 : e - this.clock();
  }

  async eval(script: string, _n: number, ...args: (string | number)[]): Promise<unknown> {
    this.guard();
    this.evalCalls++;
    const key = String(args[0]);
    this.expire(key);
    if (script === FIXED_WINDOW_LUA) {
      const win = Number(args[1]);
      const c = (this.strings.get(key) ?? 0) + 1;
      this.strings.set(key, c);
      if (c === 1) this.expiry.set(key, this.clock() + win);
      return [c, this.ttlOf(key)];
    }
    if (script === SLIDING_LUA) {
      const [now, win, max, member, record] = [Number(args[1]), Number(args[2]), Number(args[3]), String(args[4]), String(args[5])];
      const z = (this.zsets.get(key) ?? []).filter((x) => x.score > now - win);
      this.zsets.set(key, z);
      if (z.length >= max) return Math.max(1, z[0].score + win - now);
      if (record === "1") {
        z.push({ score: now, member });
        z.sort((a, b) => a.score - b.score);
        this.expiry.set(key, this.clock() + win);
      }
      return 0;
    }
    if (script === LOGIN_BUMP_LUA) {
      const [now, win, start, maxMs] = [Number(args[1]), Number(args[2]), Number(args[3]), Number(args[4])];
      const h = this.hashes.get(key) ?? {};
      const c = Number(h.count ?? 0) + 1;
      h.count = String(c);
      this.hashes.set(key, h);
      if (c === 1) this.expiry.set(key, this.clock() + win);
      if (c > start) h.blockedUntil = String(now + Math.min(2 ** (c - start) * 1000, maxMs));
      return c;
    }
    throw new Error("script desconhecido");
  }
  async hmget(key: string, ...fields: string[]): Promise<(string | null)[]> {
    this.guard();
    this.expire(key);
    const h = this.hashes.get(key);
    return fields.map((f) => h?.[f] ?? null);
  }
  async get(key: string): Promise<string | null> {
    this.guard();
    this.expire(key);
    const v = this.strings.get(key);
    return v === undefined ? null : String(v);
  }
  async pttl(key: string): Promise<number> {
    this.guard();
    return this.ttlOf(key);
  }
  async del(...keys: string[]): Promise<number> {
    this.guard();
    let n = 0;
    for (const k of keys) n += Number(this.strings.delete(k)) + Number(this.hashes.delete(k)) + Number(this.zsets.delete(k));
    return n;
  }
}
