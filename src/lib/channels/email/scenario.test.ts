import { describe, expect, it } from "vitest";
import { fromAddressForScenario } from "./scenario";

/** SPEC-046 (D-046-1) — remetente por cenário com fallback em cascata. */
describe("fromAddressForScenario (D-046-1)", () => {
  it("usa o env específico do cenário quando setado", () => {
    const env = { RESEND_FROM_NOREPLY: "no-reply@dominio.com" };
    expect(fromAddressForScenario("password_reset", env)).toBe("no-reply@dominio.com");
  });

  it("billing_reminder, subscription_success e subscription_canceled usam o mesmo env RESEND_FROM_BILLING", () => {
    const env = { RESEND_FROM_BILLING: "cobranca@dominio.com" };
    expect(fromAddressForScenario("billing_reminder", env)).toBe("cobranca@dominio.com");
    expect(fromAddressForScenario("subscription_success", env)).toBe("cobranca@dominio.com");
    expect(fromAddressForScenario("subscription_canceled", env)).toBe("cobranca@dominio.com");
  });

  it("courtesy_welcome usa RESEND_FROM_SUPPORT", () => {
    const env = { RESEND_FROM_SUPPORT: "suporte@dominio.com" };
    expect(fromAddressForScenario("courtesy_welcome", env)).toBe("suporte@dominio.com");
  });

  it("sem env específico: cai para RESEND_FROM_EMAIL genérico", () => {
    const env = { RESEND_FROM_EMAIL: "generico@dominio.com" };
    expect(fromAddressForScenario("password_reset", env)).toBe("generico@dominio.com");
  });

  it("sem nenhum RESEND_FROM_*: cai para SMTP_USER", () => {
    const env = { SMTP_USER: "smtp-user@dominio.com" };
    expect(fromAddressForScenario("password_reset", env)).toBe("smtp-user@dominio.com");
  });

  it("sem nada configurado: default fixo no-reply@leadforge.local", () => {
    expect(fromAddressForScenario("password_reset", {})).toBe("no-reply@leadforge.local");
  });
});

describe("fromAddressForScenario — ACS (SPEC-048, D-048-5)", () => {
  const env = { ACS_FROM_NOREPLY: "n@a.com", ACS_FROM_SUPPORT: "s@a.com", ACS_FROM_BILLING: "b@a.com", RESEND_FROM_NOREPLY: "r@x.com" };
  it("provider acs usa ACS_FROM_* por cenário", () => {
    expect(fromAddressForScenario("password_reset", env, "acs")).toBe("n@a.com");
    expect(fromAddressForScenario("courtesy_welcome", env, "acs")).toBe("s@a.com");
    expect(fromAddressForScenario("subscription_canceled", env, "acs")).toBe("b@a.com");
  });
  it("cenário sem ACS_FROM específico cai em ACS_FROM_NOREPLY; outros providers ignoram ACS_FROM_*", () => {
    expect(fromAddressForScenario("billing_reminder", { ACS_FROM_NOREPLY: "n@a.com" }, "acs")).toBe("n@a.com");
    expect(fromAddressForScenario("password_reset", env, "resend")).toBe("r@x.com");
  });
});

