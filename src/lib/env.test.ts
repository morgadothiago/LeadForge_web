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
  describe("TRUSTED_PROXY_IP_HEADER (SPEC-049, D-049-14)", () => {
    const base = { DATABASE_URL: "x", AUTH_SECRET: SECRET };
    it("é obrigatória em produção", () => {
      expect(() => parseEnv({ ...base, NODE_ENV: "production" })).toThrow(/TRUSTED_PROXY_IP_HEADER/);
      expect(() => parseEnv({ ...base, NODE_ENV: "production", TRUSTED_PROXY_IP_HEADER: "  " })).toThrow();
    });
    it("aceita em produção quando definida", () => {
      expect(parseEnv({ ...base, NODE_ENV: "production", TRUSTED_PROXY_IP_HEADER: "x-real-ip" }).TRUSTED_PROXY_IP_HEADER).toBe("x-real-ip");
    });
    it("não exige fora de produção nem durante o build", () => {
      expect(parseEnv({ ...base, NODE_ENV: "development" }).TRUSTED_PROXY_IP_HEADER).toBeUndefined();
      expect(parseEnv({ ...base }).TRUSTED_PROXY_IP_HEADER).toBeUndefined();
      expect(() => parseEnv({ ...base, NODE_ENV: "production", NEXT_PHASE: "phase-production-build" })).not.toThrow();
    });
  });
});
