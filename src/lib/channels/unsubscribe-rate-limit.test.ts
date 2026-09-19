import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");

import { createUnsubscribeToken } from "./unsubscribe";
import { MAX_KEYS, RATE_MAX, RATE_WINDOW_MS, TOKEN_MAX, _rateLimitSize, _resetUnsubscribeRateLimit, rateLimitRetrySeconds } from "./unsubscribe-rate-limit";

beforeEach(() => _resetUnsubscribeRateLimit());
const T0 = 1_800_000_000_000;

describe("unsubscribe rate limit (teto de memória)", () => {
  it("token forjado/inválido não cria chave por token", () => {
    for (let i = 0; i < 500; i++) rateLimitRetrySeconds("unknown", `lixo${i}`, T0);
    expect(_rateLimitSize()).toBe(1); // só a chave global
  });

  it("token válido cria chave e é limitado a TOKEN_MAX/min", () => {
    const tok = createUnsubscribeToken("lead-1", new Date(T0));
    let r: number | null = null;
    for (let i = 0; i <= TOKEN_MAX; i++) r = rateLimitRetrySeconds("unknown", tok, T0);
    expect(r).toBeGreaterThan(0);
  });

  it("nunca passa de MAX_KEYS; lotado só de chaves ativas -> descarta não bloqueadas mais antigas", () => {
    for (let i = 0; i < MAX_KEYS + 500; i++) rateLimitRetrySeconds(`ip${i}`, null, T0);
    expect(_rateLimitSize()).toBeLessThanOrEqual(MAX_KEYS);
  });

  it("não descarta bloqueio ativo: IP bloqueado continua bloqueado com o mapa lotado", () => {
    for (let i = 0; i <= RATE_MAX; i++) rateLimitRetrySeconds("6.6.6.6", null, T0); // bloqueado (mais antigo)
    for (let i = 0; i < MAX_KEYS + 300; i++) rateLimitRetrySeconds(`ip${i}`, null, T0);
    expect(_rateLimitSize()).toBeLessThanOrEqual(MAX_KEYS);
    expect(rateLimitRetrySeconds("6.6.6.6", null, T0 + 1000)).toBeGreaterThan(0);
  });

  it("lotado com as mais antigas todas bloqueadas: IP novo recebe 429 curto e mapa não cresce", () => {
    for (let i = 0; i < MAX_KEYS; i++) for (let j = 0; j <= RATE_MAX; j++) rateLimitRetrySeconds(`b${i}`, null, T0);
    expect(_rateLimitSize()).toBe(MAX_KEYS);
    expect(rateLimitRetrySeconds("novo", null, T0)).toBe(1);
    expect(_rateLimitSize()).toBe(MAX_KEYS);
  });

  it("chaves expiradas são varridas (amortizado) e liberam espaço", () => {
    for (let i = 0; i < 100; i++) rateLimitRetrySeconds(`ip${i}`, null, T0);
    rateLimitRetrySeconds("outro", null, T0 + RATE_WINDOW_MS + 20_000);
    expect(_rateLimitSize()).toBe(1);
  });
});
