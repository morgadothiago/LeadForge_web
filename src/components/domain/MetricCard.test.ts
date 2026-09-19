import { describe, expect, it } from "vitest";
import { resolveDirection } from "./MetricCard";

describe("resolveDirection", () => {
  it("usa a direção explícita (0% flat é neutro)", () => {
    expect(resolveDirection(0, "flat")).toBe("flat");
    expect(resolveDirection(5, "up")).toBe("up");
  });
  it("deriva do sinal quando não informada", () => {
    expect(resolveDirection(0)).toBe("flat");
    expect(resolveDirection(-3)).toBe("down");
    expect(resolveDirection(3)).toBe("up");
  });
});
