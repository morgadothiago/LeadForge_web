import { describe, expect, it } from "vitest";
import { formatVerification, getPreset, providerLabel } from "./email-presets";

describe("presets", () => {
  it("gmail sugere host e porta", () => {
    expect(getPreset("gmail")).toMatchObject({ smtpHost: "smtp.gmail.com", port: 587, appPassword: true });
  });
  it("desconhecido cai em Outro", () => {
    expect(getPreset("xyz").value).toBe("outro");
    expect(getPreset(null).smtpHost).toBe("");
  });
  it("rótulo", () => {
    expect(providerLabel("zoho")).toBe("Zoho Mail");
    expect(providerLabel("custom")).toBe("custom");
  });
});

describe("formatVerification", () => {
  it("nunca verificada", () => expect(formatVerification(null, null)).toEqual({ tone: "none", text: "Nunca verificada" }));
  it("erro tem prioridade", () => {
    expect(formatVerification(new Date(), "Falha de autenticação.")).toEqual({ tone: "error", text: "Erro: Falha de autenticação." });
  });
  it("verificada em data (fuso SP)", () => {
    const r = formatVerification(new Date("2026-09-19T15:30:00Z"), null);
    expect(r.tone).toBe("ok");
    expect(r.text).toMatch(/^Verificada em 19\/09\/2026,? 12:30$/);
  });
});
