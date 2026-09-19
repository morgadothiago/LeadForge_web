import { describe, expect, it } from "vitest";
import { effectiveDailyLimit, stepDownWarmupStart, warmupDay } from "./warmup";
import { BURST_PAUSE_MAX_MS, BURST_PAUSE_MIN_MS, MAX_INTERVAL_MS, MIN_INTERVAL_MS, nextAllowedSendAt } from "./rate";
import { expandSpintax, validateSpintax } from "@/lib/templates/spintax";
import { renderTemplate } from "@/lib/templates/render";
import { validateFirstTouchTemplate } from "./first-touch";
import { decideHealth, type HealthMetrics } from "./health";

const DAY = 24 * 3600_000;
const start = new Date("2026-06-01T12:00:00Z");
const at = (day: number) => new Date(start.getTime() + (day - 1) * DAY + 3600_000); // dia N de aquecimento

describe("effectiveDailyLimit (rampa)", () => {
  it("dias 1,4,8,15,22,30 com teto 30", () => {
    expect([1, 3, 4, 7, 8, 14, 15, 21, 22, 30].map((d) => effectiveDailyLimit(30, start, at(d)))).toEqual([3, 3, 6, 6, 12, 12, 20, 20, 30, 30]);
    expect([1, 4, 8, 15, 22, 30].map((d) => warmupDay(start, at(d)))).toEqual([1, 4, 8, 15, 22, 30]);
  });
  it("efetivo = min(teto, rampa): teto baixo limita, teto 40 libera na semana 4", () => {
    expect(effectiveDailyLimit(2, start, at(4))).toBe(2);
    expect(effectiveDailyLimit(10, start, at(22))).toBe(10);
    expect(effectiveDailyLimit(40, start, at(22))).toBe(40);
    expect(effectiveDailyLimit(200, start, at(22))).toBe(40); // nunca acima do máximo
  });
  it("sem warmupStartedAt = dia 1; warning desce um degrau; paused = 0", () => {
    expect(effectiveDailyLimit(30, null, start)).toBe(3);
    expect(effectiveDailyLimit(30, start, at(8), "warning")).toBe(6);
    expect(effectiveDailyLimit(30, start, at(1), "warning")).toBe(3);
    expect(effectiveDailyLimit(30, start, at(22), "warning")).toBe(20);
    expect(effectiveDailyLimit(30, start, at(22), "paused")).toBe(0);
  });
  it("retomada recua um degrau (dia 25 -> dia 15; dia 9 -> dia 4; dia 2 -> dia 1)", () => {
    const now = at(25);
    expect(warmupDay(stepDownWarmupStart(start, now), now)).toBe(15);
    expect(warmupDay(stepDownWarmupStart(start, at(9)), at(9))).toBe(4);
    expect(warmupDay(stepDownWarmupStart(start, at(2)), at(2))).toBe(1);
  });
});

describe("nextAllowedSendAt (45-180 s; rajadas de 5 + pausa 10-20 min)", () => {
  const now = new Date("2026-06-10T13:30:00Z");
  it("sem envio anterior -> agora", () => expect(nextAllowedSendAt([], now, () => 0.5)).toBe(now));
  it("intervalo mínimo 45s e máximo 180s (rng injetável)", () => {
    expect(nextAllowedSendAt([now], now, () => 0).getTime() - now.getTime()).toBe(MIN_INTERVAL_MS);
    expect(nextAllowedSendAt(now, now, () => 0.999999).getTime() - now.getTime()).toBe(MAX_INTERVAL_MS);
    expect(nextAllowedSendAt([now], now, () => 0.5).getTime() - now.getTime()).toBeGreaterThanOrEqual(MIN_INTERVAL_MS);
  });
  it("já passou o intervalo -> agora; respeita o tempo decorrido", () => {
    expect(nextAllowedSendAt([new Date(now.getTime() - 181_000)], now, () => 0.999999)).toBe(now);
    expect(nextAllowedSendAt([new Date(now.getTime() - 10_000)], now, () => 0).getTime() - now.getTime()).toBe(35_000);
  });
  it("rajada: 5 envios seguidos -> pausa 10-20 min; 4 não", () => {
    const burst = (n: number) => Array.from({ length: n }, (_, i) => new Date(now.getTime() - i * 60_000));
    expect(nextAllowedSendAt(burst(4), now, () => 0).getTime() - now.getTime()).toBe(MIN_INTERVAL_MS);
    expect(nextAllowedSendAt(burst(5), now, () => 0).getTime() - now.getTime()).toBe(BURST_PAUSE_MIN_MS);
    expect(nextAllowedSendAt(burst(5), now, () => 0.9999999).getTime() - now.getTime()).toBeGreaterThan(BURST_PAUSE_MAX_MS - 1000);
    expect(nextAllowedSendAt(burst(5), now, () => 0.9999999).getTime() - now.getTime()).toBeLessThanOrEqual(BURST_PAUSE_MAX_MS);
  });
  it("pausa longa quebra a rajada (recomeça a contagem)", () => {
    const list = [now, new Date(now.getTime() - 60_000), new Date(now.getTime() - 120_000), new Date(now.getTime() - 3 * 3600_000), new Date(now.getTime() - 3 * 3600_000 - 60_000)];
    expect(nextAllowedSendAt(list, now, () => 0).getTime() - now.getTime()).toBe(MIN_INTERVAL_MS);
  });
  it("rng default é determinístico para o mesmo último envio", () => {
    expect(nextAllowedSendAt([now], now).getTime()).toBe(nextAllowedSendAt([now], now).getTime());
  });
});

describe("spintax", () => {
  it("determinístico por seed; seeds diferentes variam", () => {
    const body = "{Oi|Olá|E aí} {{firstName}}, {tudo bem|como vai}?";
    expect(expandSpintax(body, "lead1:step1")).toBe(expandSpintax(body, "lead1:step1"));
    const seen = new Set(Array.from({ length: 40 }, (_, i) => expandSpintax(body, `lead${i}:step`)));
    expect(seen.size).toBeGreaterThan(3);
    for (const v of seen) expect(v).toMatch(/^(Oi|Olá|E aí) \{\{firstName\}\}, (tudo bem|como vai)\?$/);
  });
  it("não conflita com {{variavel}} e o render final funciona", () => {
    const out = expandSpintax("{A|B} {{name}} {{company}}", "x");
    const r = renderTemplate(out, { name: "Ana", company: "Acme" }, { channel: "whatsapp" });
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.text).toMatch(/^(A|B) Ana Acme$/);
  });
  it("validação: desbalanceado, vazio, opção vazia, aninhado", () => {
    expect(validateSpintax("{a|b} {{name}} ok")).toBeNull();
    expect(validateSpintax("texto {a|b")).toMatch(/não foi fechada/);
    expect(validateSpintax("texto a|b}")).toMatch(/sem a \{/);
    expect(validateSpintax("texto {} x")).toMatch(/vazio/);
    expect(validateSpintax("{a||b}")).toMatch(/opção vazia/);
    expect(validateSpintax("{a|{b|c}}")).toMatch(/aninhamento/);
    expect(validateSpintax("Oi {{name}")).not.toBeNull();
  });
});

describe("validateFirstTouchTemplate", () => {
  const good = "Oi {{firstName}}, sou o Thiago da LeadForge. Vocês usam algum controle de leads hoje? Se não fizer sentido, é só responder NÃO.";
  it("template bom = sem avisos", () => expect(validateFirstTouchTemplate(good)).toEqual([]));
  it("avisa URL, tamanho, promo e falta de saída", () => {
    expect(validateFirstTouchTemplate(`${good} Veja https://x.com/a`).join(" ")).toMatch(/link/);
    expect(validateFirstTouchTemplate(`${good} ${"a".repeat(360)}`).join(" ")).toMatch(/caracteres/);
    expect(validateFirstTouchTemplate(`${good} Aproveite a promoção com desconto!`).join(" ")).toMatch(/promocionais/);
    expect(validateFirstTouchTemplate("Oi, sou o Thiago. Posso te mandar uma proposta?").join(" ")).toMatch(/saída fácil/);
  });
  it("lista de palavras configurável e tamanho considera a variante mais longa do spintax", () => {
    expect(validateFirstTouchTemplate(`${good} foobar`, ["foobar"]).join(" ")).toMatch(/foobar/);
    expect(validateFirstTouchTemplate(`{${"a".repeat(400)}|b} responda NÃO`).join(" ")).toMatch(/caracteres/);
  });
});

describe("decideHealth (gatilhos do disjuntor)", () => {
  const ok: HealthMetrics = { sends: 30, deliveryRate: 0.97, deliverySample: 20, consecutiveFailures: 0, replyRate: 0.1, optOutRate: 0, optOutSample: 25 };
  it("saudável = good", () => expect(decideHealth(ok)).toMatchObject({ state: "good" }));
  it("2 falhas consecutivas pausa 24h; 1 falha = warning", () => {
    expect(decideHealth({ ...ok, consecutiveFailures: 2 })).toMatchObject({ state: "paused", pause: { hours: 24 } });
    expect(decideHealth({ ...ok, consecutiveFailures: 1 }).state).toBe("warning");
  });
  it("entrega < 80% pausa; 80-90% warning; amostra insuficiente (null) não dispara", () => {
    expect(decideHealth({ ...ok, deliveryRate: 0.75 }).state).toBe("paused");
    expect(decideHealth({ ...ok, deliveryRate: 0.85 }).state).toBe("warning");
    expect(decideHealth({ ...ok, deliveryRate: null, deliverySample: 4 }).state).toBe("good");
  });
  it("opt-out > 5% pausa só com amostra >= 20; > 2% warning com >= 10", () => {
    expect(decideHealth({ ...ok, optOutRate: 0.1, optOutSample: 20 }).state).toBe("paused");
    expect(decideHealth({ ...ok, optOutRate: 0.1, optOutSample: 12 }).state).toBe("warning");
    expect(decideHealth({ ...ok, optOutRate: 0.5, optOutSample: 4 }).state).toBe("good");
    expect(decideHealth({ ...ok, optOutRate: 0.05, optOutSample: 40 }).state).toBe("warning"); // não é > 5% (pausa), mas > 2% (warning)
  });
});
