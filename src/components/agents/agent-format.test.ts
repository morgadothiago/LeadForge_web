import { describe, expect, it } from "vitest";
import { bulkSummary, canApprove, canBulk, canConfirmAuto, canReject, disclosureOffDowngrades, guardrailsLabel, isEdited, needsAutoConfirm, parseBudgetToCents, parseLines, resolveBudgetInput, toggleId, usageLevel, usagePercent } from "./agent-format";

describe("agent-format", () => {
  it("alerta em 80% e pausa em 100%", () => {
    expect(usageLevel(79, 100)).toBe("ok");
    expect(usageLevel(80, 100)).toBe("warn");
    expect(usageLevel(100, 100)).toBe("stop");
    expect(usageLevel(5, null)).toBe("none");
    expect(usagePercent(250, 100)).toBe(100);
  });
  it("parse de orçamento e linhas", () => {
    expect(parseBudgetToCents("50,5")).toBe(5050);
    expect(parseBudgetToCents("0")).toBeNull();
    expect(parseBudgetToCents("abc")).toBeNull();
    expect(parseLines("a\n\n b ")).toEqual(["a", "b"]);
  });
  it("teto: inválido dá erro, vazio só limpa se explícito", () => {
    expect(resolveBudgetInput("abc").ok).toBe(false);
    expect(resolveBudgetInput("0").ok).toBe(false);
    expect(resolveBudgetInput("").ok).toBe(false);
    expect(resolveBudgetInput("", true)).toEqual({ ok: true, cents: null });
    expect(resolveBudgetInput("12", true).ok).toBe(false);
    expect(resolveBudgetInput("50,5")).toEqual({ ok: true, cents: 5050 });
  });
  it("lógica de aprovar/editar/rejeitar/lote", () => {
    expect(isEdited(" a ", "a")).toBe(false);
    expect(isEdited("b", "a")).toBe(true);
    expect(canApprove("x", false)).toBe(true);
    expect(canApprove("  ", false)).toBe(false);
    expect(canApprove("x", false, true)).toBe(false);
    expect(canReject("", false)).toBe(false);
    expect(canReject("spam", true)).toBe(false);
    expect(canBulk(0, false)).toBe(false);
    expect(canBulk(2, true)).toBe(false);
    expect(canBulk(2, false)).toBe(true);
    const s = toggleId(new Set(["a"]), "b");
    expect([...s]).toEqual(["a", "b"]);
    expect([...toggleId(s, "a")]).toEqual(["b"]);
    expect(bulkSummary({ sent: 2, blocked: 1, skipped: 1 })).toContain("1 já tratado");
    expect(bulkSummary({ sent: 2, blocked: 0 })).not.toContain("tratado");
  });
  it("autonomia do Closer e aviso de IA", () => {
    expect(needsAutoConfirm("closer", "auto")).toBe(true);
    expect(needsAutoConfirm("closer", "draft")).toBe(false);
    expect(needsAutoConfirm("sdr", "auto")).toBe(false);
    expect(canConfirmAuto(true, true, true, false)).toBe(true);
    expect(canConfirmAuto(true, false, true, false)).toBe(false);
    expect(canConfirmAuto(true, true, false, false)).toBe(false);
    expect(canConfirmAuto(true, true, true, true)).toBe(false);
    expect(disclosureOffDowngrades("closer", "auto", false)).toBe(true);
    expect(disclosureOffDowngrades("closer", "draft", false)).toBe(false);
    expect(disclosureOffDowngrades("closer", "auto", true)).toBe(false);
    expect(guardrailsLabel(["a", "b"])).toBe("a, b");
    expect(guardrailsLabel([])).toBe("");
  });
});
