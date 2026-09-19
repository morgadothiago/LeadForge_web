import { describe, expect, it } from "vitest";
import { formatRate, limitExplanation, pausedText, usagePercent, usageText, validateDailyLimit, warmupRampText, warmupText } from "./health-format";

describe("validateDailyLimit", () => {
  it("aceita 1 a 40", () => {
    expect(validateDailyLimit("1")).toBeNull();
    expect(validateDailyLimit("40")).toBeNull();
  });
  it("recusa 0, 41, 200 e não inteiros", () => {
    expect(validateDailyLimit("0")).toMatch(/mínimo/);
    expect(validateDailyLimit("41")).toMatch(/máximo é 40/);
    expect(validateDailyLimit("200")).toMatch(/máximo/);
    expect(validateDailyLimit("1.5")).toMatch(/inteiro/);
    expect(validateDailyLimit("")).toMatch(/inteiro/);
  });
});

describe("rampa e limite efetivo", () => {
  it("texto da rampa usa o teto", () => {
    const t = warmupRampText(30);
    expect(t).toContain("Dias 1 a 3: 3");
    expect(t).toContain("Semana 3 (dias 15 a 21): 20");
    expect(t).toContain("Semana 4 em diante: até 30");
  });
  it("explica teto vs hoje", () => {
    expect(limitExplanation(6, 30)).toMatch(/Teto configurado: 30.*limite é 6.*aquecimento/);
    expect(limitExplanation(30, 30)).toMatch(/no teto/);
    expect(limitExplanation(0, 30)).toMatch(/pausada/);
  });
  it("uso diário", () => {
    expect(usagePercent(5, 12)).toBe(42);
    expect(usagePercent(20, 12)).toBe(100);
    expect(usagePercent(3, 0)).toBe(0);
    expect(usageText(5, 12)).toBe("5 de 12 enviadas hoje");
    expect(usageText(0, 0)).toMatch(/nenhum envio liberado/);
  });
  it("dia de aquecimento", () => {
    expect(warmupText(4)).toBe("Dia 4 de aquecimento");
    expect(warmupText(null)).toMatch(/não iniciado/);
  });
});

describe("métricas e pausa", () => {
  it("formata taxa e amostra insuficiente", () => {
    expect(formatRate(0.856)).toBe("85,6%");
    expect(formatRate(1)).toBe("100%");
    expect(formatRate(null)).toBe("dados insuficientes");
  });
  it("texto de pausa", () => {
    const f = () => "20/09/2026 10:00";
    expect(pausedText(new Date(), "2 falhas seguidas.", f)).toBe("Pausada até 20/09/2026 10:00 por: 2 falhas seguidas.");
    expect(pausedText(null, null, f)).toBe("Pausada");
  });
});
