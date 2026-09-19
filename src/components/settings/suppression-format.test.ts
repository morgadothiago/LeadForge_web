import { describe, expect, it } from "vitest";
import { buildSuppressionQuery, maskSuppressedValue, parseSuppressionParams, revealSuppressedValue, suppressionReasonLabel } from "./suppression-format";

describe("maskSuppressedValue", () => {
  it("mascara e-mail", () => {
    expect(maskSuppressedValue("email", "joao@empresa.com")).toBe("jo***@empresa.com");
    expect(maskSuppressedValue("email", "a@b.com")).toBe("a***@b.com");
    expect(maskSuppressedValue("email", "semarroba")).toBe("***");
  });
  it("mascara telefone E.164", () => {
    expect(maskSuppressedValue("phone", "+5511912345678")).toBe("(11) 9****-5678");
    expect(maskSuppressedValue("phone", "123")).toBe("****");
  });
  it("revela formatado", () => {
    expect(revealSuppressedValue("phone", "+5511912345678")).toBe("(11) 91234-5678");
    expect(revealSuppressedValue("email", "a@b.com")).toBe("a@b.com");
  });
});

describe("rótulos de motivo", () => {
  it("traduz e cai no valor cru se desconhecido", () => {
    expect(suppressionReasonLabel("opt_out_reply")).toBe("Pediu para parar (resposta)");
    expect(suppressionReasonLabel("bounce")).toMatch(/bounce/);
    expect(suppressionReasonLabel("x")).toBe("x");
  });
});

describe("filtros", () => {
  it("parse ignora tipo inválido e página ruim", () => {
    expect(parseSuppressionParams({ kind: "sms", q: "  ", page: "0" })).toEqual({ page: 1 });
    expect(parseSuppressionParams({ kind: ["email"], q: " ana ", page: "3" })).toEqual({ kind: "email", q: "ana", page: 3 });
  });
  it("monta query estável", () => {
    expect(buildSuppressionQuery({ page: 1 })).toBe("");
    expect(buildSuppressionQuery({ kind: "phone", q: "11", page: 2 })).toBe("?kind=phone&q=11&page=2");
    expect(buildSuppressionQuery({ kind: "phone", page: 5 }, { page: 1 })).toBe("?kind=phone");
  });
});
