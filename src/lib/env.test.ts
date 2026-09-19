import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const SECRET = "x".repeat(32);

describe("parseEnv", () => {
  it("aceita env minimo", () => {
    expect(parseEnv({ DATABASE_URL: "postgresql://x", AUTH_SECRET: SECRET }).DATABASE_URL).toBe("postgresql://x");
  });
  it("falha sem DATABASE_URL", () => {
    expect(() => parseEnv({})).toThrow();
  });
  it("exige AUTH_SECRET com 32+ caracteres", () => {
    expect(() => parseEnv({ DATABASE_URL: "x" })).toThrow();
    expect(() => parseEnv({ DATABASE_URL: "x", AUTH_SECRET: "curto" })).toThrow();
  });
  it("coage SMTP_PORT", () => {
    expect(parseEnv({ DATABASE_URL: "x", AUTH_SECRET: SECRET, SMTP_PORT: "587" }).SMTP_PORT).toBe(587);
  });
});
