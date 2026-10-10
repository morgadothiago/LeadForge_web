import { describe, expect, it } from "vitest";
import { acsConfigured, getEmailProvider, getEmailProviderChain, resendConfigured } from "./provider";
import { SmtpEmailProvider } from "./providers/smtp";
import { ResendEmailProvider } from "./providers/resend";
import { AcsEmailProvider } from "./providers/acs";

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

describe("getEmailProviderChain (SPEC-048, D-048-1)", () => {
  const ACS = { AZURE_COMMUNICATION_CONNECTION_STRING: "endpoint=https://x/;accesskey=k" };
  const names = (env: Record<string, string>) => getEmailProviderChain(env).map((p) => p.name);

  it("acsConfigured só com connection string", () => {
    expect(acsConfigured({})).toBe(false);
    expect(acsConfigured(ACS)).toBe(true);
  });
  it("EMAIL_PROVIDER=acs + ACS: acs -> resend -> smtp", () => {
    expect(names({ ...ACS, EMAIL_PROVIDER: "acs", RESEND_API_KEY: "re_x" })).toEqual(["acs", "resend", "smtp"]);
    expect(getEmailProvider({ ...ACS, EMAIL_PROVIDER: "acs" })).toBeInstanceOf(AcsEmailProvider);
  });
  it("EMAIL_PROVIDER=acs sem Resend: acs -> smtp", () => {
    expect(names({ ...ACS, EMAIL_PROVIDER: "acs" })).toEqual(["acs", "smtp"]);
  });
  it("EMAIL_PROVIDER=acs sem ACS configurado: comportamento atual", () => {
    expect(names({ EMAIL_PROVIDER: "acs", RESEND_API_KEY: "re_x" })).toEqual(["resend", "smtp"]);
    expect(names({ EMAIL_PROVIDER: "acs" })).toEqual(["smtp"]);
  });
  it("ACS configurado mas EMAIL_PROVIDER ausente: ACS não é usado", () => {
    expect(names({ ...ACS, RESEND_API_KEY: "re_x" })).toEqual(["resend", "smtp"]);
  });
  it("EMAIL_PROVIDER=smtp: só smtp", () => {
    expect(names({ ...ACS, EMAIL_PROVIDER: "smtp", RESEND_API_KEY: "re_x" })).toEqual(["smtp"]);
  });
});
