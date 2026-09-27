import { describe, expect, it } from "vitest";
import { getEmailProvider, resendConfigured } from "./provider";
import { SmtpEmailProvider } from "./providers/smtp";
import { ResendEmailProvider } from "./providers/resend";

/** SPEC-046 — factory por env, mesmo padrão de `src/lib/billing/provider-factory.ts` (D-33-5). */
describe("resendConfigured", () => {
  it("false sem RESEND_API_KEY", () => {
    expect(resendConfigured({})).toBe(false);
  });
  it("false com RESEND_API_KEY em branco", () => {
    expect(resendConfigured({ RESEND_API_KEY: "   " })).toBe(false);
  });
  it("true com RESEND_API_KEY setada", () => {
    expect(resendConfigured({ RESEND_API_KEY: "re_abc" })).toBe(true);
  });
});

describe("getEmailProvider", () => {
  it("sem RESEND_API_KEY: devolve SmtpEmailProvider", () => {
    const provider = getEmailProvider({});
    expect(provider).toBeInstanceOf(SmtpEmailProvider);
    expect(provider.name).toBe("smtp");
  });

  it("com RESEND_API_KEY: devolve ResendEmailProvider", () => {
    const provider = getEmailProvider({ RESEND_API_KEY: "re_abc" });
    expect(provider).toBeInstanceOf(ResendEmailProvider);
    expect(provider.name).toBe("resend");
  });

  it("opts.provider força o retorno, mesmo com RESEND_API_KEY setada (bypass p/ testes)", () => {
    const fake = { name: "smtp" as const, send: async () => ({ messageId: "x" }) };
    const provider = getEmailProvider({ RESEND_API_KEY: "re_abc" }, { provider: fake });
    expect(provider).toBe(fake);
  });
});
