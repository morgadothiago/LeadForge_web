import { afterEach, describe, expect, it, vi } from "vitest";
import { getClientIp, getClientIpKey } from "./client-ip";

afterEach(() => vi.unstubAllEnvs());

describe("getClientIpKey (D-049-14)", () => {
  it("produção sem TRUSTED_PROXY_IP_HEADER: chave única por requisição (sem bucket global compartilhado)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TRUSTED_PROXY_IP_HEADER", "");
    const h = new Headers({ "x-forwarded-for": "1.1.1.1" });
    const a = getClientIpKey(h);
    expect(a).not.toBe("unknown");
    expect(a).not.toBe(getClientIpKey(h));
    expect(getClientIp(h)).toBe("unknown");
  });
  it("com cabeçalho confiável, devolve o IP; fora de produção mantém 'unknown'", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TRUSTED_PROXY_IP_HEADER", "x-real-ip");
    expect(getClientIpKey(new Headers({ "x-real-ip": "5.5.5.5" }))).toBe("5.5.5.5");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("TRUSTED_PROXY_IP_HEADER", "");
    expect(getClientIpKey(new Headers())).toBe("unknown");
  });
});
