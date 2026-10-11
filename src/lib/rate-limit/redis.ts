import { createHash, createHmac } from "node:crypto";
import Redis from "ioredis";

/**
 * SPEC-059: acesso ao Redis dos rate limits. `REDIS_URL` ausente => `tryRedis` devolve undefined e o chamador usa o
 * backend em memoria. Erro do Redis => log throttled + circuito aberto por BREAKER_MS (D-059-3): idem, memoria.
 */
export const KEY_PREFIX = "lf:rl:";
export const BREAKER_MS = 5_000;
const LOG_EVERY_MS = 30_000;

/** Subconjunto de comandos usado (permite fake em testes). */
export interface RedisLike {
  /** ioredis: "wait" | "connecting" | "connect" | "ready" | "reconnecting" | "end". Ausente em fakes de teste. */
  status?: string;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  hmget(key: string, ...fields: string[]): Promise<(string | null)[]>;
  get(key: string): Promise<string | null>;
  pttl(key: string): Promise<number>;
  del(...keys: string[]): Promise<number>;
}

// Singleton em globalThis: sobrevive ao HMR do dev sem abrir uma conexao por recarga.
const g = globalThis as unknown as { __lfRlRedis?: RedisLike | null };
let client: RedisLike | null | undefined = g.__lfRlRedis; // undefined = ainda nao resolvido
let breakerUntil = 0;
let lastLog = 0;
let connecting: Promise<unknown> | undefined; // primeira conexao (lazyConnect): a 1a chamada espera um pouco por ela
const CONNECT_WAIT_MS = 800;

function build(): RedisLike | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  const r = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    commandTimeout: 500,
    connectTimeout: 1000,
    maxRetriesPerRequest: 1,
    retryStrategy: (n) => Math.min(n * 200, 2000),
  });
  r.on("error", () => undefined); // erros chegam via rejeicao dos comandos (tratados em tryRedis)
  connecting = r.connect().catch(() => undefined); // falha => status nao fica ready; tryRedis cai para a memoria
  return r as unknown as RedisLike;
}

export function getRedis(): RedisLike | null {
  if (client === undefined) {
    client = build();
    g.__lfRlRedis = client;
  }
  return client;
}

/** Testes: injeta um cliente (ou null = memoria) e fecha o circuito. */
export function _setRedisClient(c: RedisLike | null): void {
  client = c;
  g.__lfRlRedis = undefined;
  breakerUntil = 0;
  lastLog = 0;
}
/** Testes: volta a resolver por `REDIS_URL`. */
export function _resetRedisClient(): void {
  client = undefined;
  g.__lfRlRedis = undefined;
  breakerUntil = 0;
  lastLog = 0;
}

/**
 * Executa `fn` no Redis. undefined = indisponivel (sem REDIS_URL, circuito aberto ou erro): use o backend em memoria.
 * Nunca lanca. `fn` deve devolver valor !== undefined.
 */
export async function tryRedis<T>(fn: (r: RedisLike) => Promise<T>, now = Date.now()): Promise<T | undefined> {
  const r = getRedis();
  if (!r || now < breakerUntil) return undefined;
  // Conexao ainda subindo (1a chamada apos o boot): espera um pouco por ela; se nao ficar pronta, usa a memoria SEM abrir
  // o circuito. Sem isso, os primeiros requisicoes ignorariam o Redis (bloqueio persistido nao valeria logo apos reiniciar).
  if (r.status === "wait" || r.status === "connecting" || r.status === "connect") {
    if (connecting) await Promise.race([connecting, new Promise((res) => setTimeout(res, CONNECT_WAIT_MS))]);
    if ((r.status as string | undefined) !== "ready") return undefined;
  }
  try {
    return await fn(r);
  } catch (e) {
    breakerUntil = now + BREAKER_MS;
    if (now - lastLog >= LOG_EVERY_MS || lastLog === 0) {
      lastLog = now || 1;
      console.warn(`[rate-limit] Redis indisponivel; usando memoria por processo por ${BREAKER_MS / 1000}s: ${e instanceof Error ? e.message : "erro"}`);
    }
    return undefined;
  }
}

/** D-059-7: a parte variavel da chave (e-mail, IP, token...) nunca vai em claro ao Redis: HMAC-SHA256(AUTH_SECRET) truncado a 32 hex. */
export function hashKeyPart(key: string): string {
  const secret = process.env.AUTH_SECRET;
  const h = secret ? createHmac("sha256", secret) : createHash("sha256");
  return h.update(key).digest("hex").slice(0, 32);
}

export const rlKey = (ns: string, key: string): string => `${KEY_PREFIX}${ns}:${hashKeyPart(key)}`;

// ---- Scripts Lua (um EVAL = uma decisao atomica) ----

/** Janela fixa: INCR; PEXPIRE so na criacao; devolve {count, pttl}. KEYS[1]=chave, ARGV[1]=janela ms. */
export const FIXED_WINDOW_LUA = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local t = redis.call('PTTL', KEYS[1])
if t < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); t = tonumber(ARGV[1]) end
return {c, t}`;

/**
 * Janela deslizante: ARGV = now, windowMs, max, membro unico, registra(1/0). Devolve ms de espera (0 = liberado).
 * Se liberado e registra=1, adiciona a tentativa.
 */
export const SLIDING_LUA = `
local now = tonumber(ARGV[1]); local win = tonumber(ARGV[2]); local max = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - win)
local n = redis.call('ZCARD', KEYS[1])
if n >= max then
  local o = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return math.max(1, tonumber(o[2]) + win - now)
end
if ARGV[5] == '1' then
  redis.call('ZADD', KEYS[1], now, ARGV[4])
  redis.call('PEXPIRE', KEYS[1], win)
end
return 0`;

/**
 * Login: incrementa a falha. ARGV = now, windowMs, backoffStart, backoffMaxMs. Hash {count, blockedUntil}; TTL da janela na criacao.
 */
export const LOGIN_BUMP_LUA = `
local now = tonumber(ARGV[1]); local start = tonumber(ARGV[3])
local c = redis.call('HINCRBY', KEYS[1], 'count', 1)
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
if c > start then
  local b = math.min((2 ^ (c - start)) * 1000, tonumber(ARGV[4]))
  redis.call('HSET', KEYS[1], 'blockedUntil', now + b)
end
if redis.call('PTTL', KEYS[1]) < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
return c`;

/** Janela fixa no Redis: {count, ttlMs}. */
export async function redisFixedWindow(r: RedisLike, ns: string, key: string, windowMs: number): Promise<{ count: number; ttlMs: number }> {
  const res = (await r.eval(FIXED_WINDOW_LUA, 1, rlKey(ns, key), windowMs)) as [number, number];
  return { count: Number(res[0]), ttlMs: Number(res[1]) };
}

/** Espera (segundos) de um hit em janela fixa: null = liberado. */
export function fixedWait(w: { count: number; ttlMs: number }, max: number): number | null {
  return w.count > max ? Math.max(1, Math.ceil(w.ttlMs / 1000)) : null;
}

/** Hit de janela fixa no Redis: segundos de espera, null = liberado, undefined = Redis indisponivel (use a memoria). */
export async function redisHit(ns: string, key: string, max: number, windowMs: number): Promise<number | null | undefined> {
  const w = await tryRedis((r) => redisFixedWindow(r, ns, key, windowMs));
  return w === undefined ? undefined : fixedWait(w, max);
}
