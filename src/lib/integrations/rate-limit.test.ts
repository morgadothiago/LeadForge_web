import { describe, expect, it } from "vitest";
import { SlidingLimiter } from "./rate-limit";
import { _resetTestQuota, consumeSaveQuota, consumeTestQuota } from "./test-connection";
import { secretHint, SECRET_MIN, saveIntegrationSchema } from "@/lib/schemas/integration";

describe("SlidingLimiter", () => {
  it("limita, libera após a janela e limpa chaves antigas com teto", () => {
    const l = new SlidingLimiter(2, 1000, 3);
    expect(l.hit("a", 0)).toBe(0);
    expect(l.hit("a", 10)).toBe(0);
    expect(l.hit("a", 20)).toBeGreaterThan(0);
    expect(l.hit("a", 1001)).toBe(0);
    for (let i = 0; i < 50; i++) l.hit(`k${i}`, 5000 + i);
    expect(l.size).toBeLessThanOrEqual(3);
    l.hit("z", 999_999); // varredura remove as expiradas
    expect(l.size).toBeLessThanOrEqual(3);
  });
});

describe("cotas de integração", () => {
  it("por usuário (5) e por integração (8, somando usuários); save 10/min", () => {
    _resetTestQuota();
    for (let i = 0; i < 5; i++) expect(consumeTestQuota("u1", "int1", 0)).toBe(0);
    expect(consumeTestQuota("u1", "int2", 1)).toBeGreaterThan(0); // usuário estourou
    for (let i = 0; i < 3; i++) expect(consumeTestQuota(`u${i + 2}`, "int1", 2)).toBe(0); // 8 na integração
    expect(consumeTestQuota("u9", "int1", 3)).toBeGreaterThan(0); // integração estourou
    expect(consumeTestQuota("u9", "int3", 3)).toBe(0);
    for (let i = 0; i < 10; i++) expect(consumeSaveQuota("s1", 0)).toBe(0);
    expect(consumeSaveQuota("s1", 1)).toBeGreaterThan(0);
    expect(consumeSaveQuota("s2", 1)).toBe(0);
    _resetTestQuota();
  });
});

describe("hint da chave nunca revela mais que o limite", () => {
  it.each([[7, 0], [8, 2], [11, 2], [12, 2], [15, 2], [16, 4], [32, 4], [512, 4]])("chave de %i chars -> hint com no máx. %i", (len, max) => {
    const v = Array.from({ length: len }, (_, i) => String.fromCharCode(97 + (i % 26))).join("");
    const h = secretHint(v);
    expect(h.length).toBeLessThanOrEqual(max);
    expect(h.length).toBeLessThanOrEqual(Math.floor(len / 4));
    if (h) expect(v.endsWith(h)).toBe(true);
  });
  it("abaixo de 8 não revela nada; mínimo aceito é 12", () => {
    expect(secretHint("abcdefg")).toBe("");
    expect(SECRET_MIN).toBe(12);
    expect(saveIntegrationSchema.safeParse({ integration: "llm", value: "a".repeat(11) }).success).toBe(false);
    expect(saveIntegrationSchema.safeParse({ integration: "llm", value: "a".repeat(12) }).success).toBe(true);
  });
});
