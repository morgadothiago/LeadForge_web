import { describe, expect, it } from "vitest";
import { clearForgotPasswordRateLimit, forgotByEmailLimiter, forgotByIpLimiter, hashResetToken, newResetToken, RESET_TOKEN_TTL_MS } from "./password-reset";

describe("newResetToken/hashResetToken (SPEC-038)", () => {
  it("token opaco, nunca igual ao hash; hash determinístico (mesmo token -> mesmo hash)", () => {
    const { token, hash } = newResetToken();
    expect(token).not.toBe(hash);
    expect(hash).toBe(hashResetToken(token));
    expect(token.length).toBeGreaterThanOrEqual(32); // 32 bytes em base64url
    expect(hash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it("tokens gerados são únicos (aleatórios)", () => {
    const a = newResetToken();
    const b = newResetToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).not.toBe(b.hash);
  });

  it("TTL é 24 horas (D-038-1)", () => {
    expect(RESET_TOKEN_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("clearForgotPasswordRateLimit", () => {
  it("zera os dois limitadores (e-mail e IP)", () => {
    forgotByEmailLimiter.hit("email:x@y.com");
    forgotByIpLimiter.hit("ip:1.2.3.4");
    expect(forgotByEmailLimiter.size).toBeGreaterThan(0);
    expect(forgotByIpLimiter.size).toBeGreaterThan(0);
    clearForgotPasswordRateLimit();
    expect(forgotByEmailLimiter.size).toBe(0);
    expect(forgotByIpLimiter.size).toBe(0);
  });
});
