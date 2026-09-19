import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");

function lum(hex: string) {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe("design tokens", () => {
  it.each([
    ["--background", "#0a0e11"], ["--card", "#131619"], ["--muted", "#1a1d21"],
    ["--sidebar", "#111417"], ["--primary", "#1fb390"], ["--primary-hover", "#1a9e7e"],
    ["--primary-foreground", "#0a0e11"], ["--foreground", "#e9ecec"],
    ["--muted-foreground", "#747b82"], ["--destructive", "#dc2626"], ["--border", "#202226"],
  ])("%s = %s", (token, hex) => {
    expect(css).toContain(`${token}: ${hex};`);
  });
  it("contraste AA", () => {
    expect(ratio("#e9ecec", "#0a0e11")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#0a0e11", "#1fb390")).toBeGreaterThanOrEqual(4.5);
  });
  it("--warning tem contraste AA sobre card e sobre fundo", () => {
    expect(css).toContain("--warning: #f5b638;");
    expect(ratio("#f5b638", "#131619")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#f5b638", "#0a0e11")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#0a0e11", "#f5b638")).toBeGreaterThanOrEqual(4.5);
  });
});
