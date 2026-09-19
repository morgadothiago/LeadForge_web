import { describe, expect, it } from "vitest";
import { auditActionLabel, formatAuditRow, isRateLimitMessage, maskHint, originLabel, statusLabel, validateBaseUrl } from "./integration-format";

describe("rótulos", () => {
  it("origem", () => {
    expect(originLabel("db")).toBe("Salva no painel");
    expect(originLabel("env")).toMatch(/\.env.*prioridade/);
    expect(originLabel("none")).toBe("Não configurada");
  });
  it("estado", () => {
    expect(statusLabel(true)).toBe("Configurada");
    expect(statusLabel(false)).toBe("Não configurada");
  });
});
describe("maskHint", () => {
  it("mascara e limita a 4", () => {
    expect(maskHint("1234")).toBe("••••1234");
    expect(maskHint("abcdef1234")).toBe("••••1234");
    expect(maskHint("")).toBe("••••");
    expect(maskHint(null)).toBe("••••");
  });
});
describe("auditoria", () => {
  it("ações", () => {
    expect(auditActionLabel("rotate")).toBe("Girou a chave");
    expect(auditActionLabel("update_url")).toBe("Alterou a URL");
    expect(auditActionLabel("zzz")).toBe("zzz");
  });
  it("linha", () => {
    expect(formatAuditRow({ integration: "evolution", action: "create", userName: "Ana", hostMasked: "ev***.com", allowPrivateHost: true })).toEqual({
      integration: "Evolution API", action: "Criou", user: "Ana", host: "ev***.com (instância própria)",
    });
    expect(formatAuditRow({ integration: "llm", action: "delete", userName: null, hostMasked: null, allowPrivateHost: null })).toMatchObject({ user: "Usuário removido", host: "—" });
  });
});
describe("validateBaseUrl", () => {
  it("obrigatoriedade", () => {
    expect(validateBaseUrl(" ", true)).toBe("Informe a URL.");
    expect(validateBaseUrl("", false)).toBeUndefined();
  });
  it("formato", () => {
    expect(validateBaseUrl("evolution", true)).toMatch(/inválida/);
    expect(validateBaseUrl("ftp://x.com", true)).toMatch(/http/);
    expect(validateBaseUrl("https://u:p@x.com", true)).toMatch(/usuário/);
    expect(validateBaseUrl("https://x.com/?a=1", true)).toMatch(/\?/);
    expect(validateBaseUrl("https://x.com/#a", true)).toMatch(/#/);
    expect(validateBaseUrl("http://localhost:8080", true)).toBeUndefined();
  });
});
describe("rate limit", () => {
  it("detecta", () => {
    expect(isRateLimitMessage("Muitos testes seguidos. Tente novamente em 12s.")).toBe(true);
    expect(isRateLimitMessage("Erro")).toBe(false);
  });
});
