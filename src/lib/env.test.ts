import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("aceita env minimo", () => {
    expect(parseEnv({ DATABASE_URL: "postgresql://x" }).DATABASE_URL).toBe("postgresql://x");
  });
  it("falha sem DATABASE_URL", () => {
    expect(() => parseEnv({})).toThrow();
  });
  it("coage SMTP_PORT", () => {
    expect(parseEnv({ DATABASE_URL: "x", SMTP_PORT: "587" }).SMTP_PORT).toBe(587);
  });
});
