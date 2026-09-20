import { describe, expect, it } from "vitest";
import { parseBudgetToCents, parseLines, usageLevel, usagePercent } from "./agent-format";

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
});
