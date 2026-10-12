// @vitest-environment node
import { describe, expect, it } from "vitest";
import { canonicalDocumentKey, isValidCnpj, isValidCpf, onlyDigits, parseDocument } from "./document";
import { randomCnpj, randomCpf } from "@/lib/test-utils/document";

describe("validador de CPF/CNPJ (SPEC-065, D-065-27)", () => {
  it("CPF valido com e sem mascara", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224725")).toBe(true);
    expect(parseDocument("529.982.247-25")).toEqual({ type: "cpf", digits: "52998224725" });
  });
  it("CPF invalido: digito verificador errado, tamanho errado e sequencias repetidas", () => {
    expect(isValidCpf("529.982.247-26")).toBe(false);
    expect(isValidCpf("123")).toBe(false);
    expect(isValidCpf("")).toBe(false);
    for (let d = 0; d <= 9; d++) expect(isValidCpf(String(d).repeat(11)), `cpf ${d}x11`).toBe(false);
    expect(parseDocument("111.111.111-11")).toBeNull();
  });
  it("CNPJ valido com e sem mascara; invalido (digito, tamanho, sequencia repetida)", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000181")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-82")).toBe(false);
    expect(isValidCnpj("1122233300018")).toBe(false);
    for (let d = 0; d <= 9; d++) expect(isValidCnpj(String(d).repeat(14)), `cnpj ${d}x14`).toBe(false);
    expect(parseDocument("00.000.000/0000-00")).toBeNull();
    expect(parseDocument("11.222.333/0001-81")).toEqual({ type: "cnpj", digits: "11222333000181" });
  });
  it("lixo e letras nao validam; geradores de teste produzem documentos validos", () => {
    expect(parseDocument("abc")).toBeNull();
    expect(parseDocument("52998224725x")).toEqual({ type: "cpf", digits: "52998224725" }); // mascara/ruido nao-numerico e ignorado
    for (let i = 0; i < 50; i++) {
      expect(isValidCpf(randomCpf())).toBe(true);
      expect(isValidCnpj(randomCnpj())).toBe(true);
    }
    expect(onlyDigits("11.222.333/0001-81")).toBe("11222333000181");
  });
  it("chave canonica: CPF = 11 digitos; CNPJ = RAIZ de 8 digitos (matriz e filial = mesma chave)", () => {
    expect(canonicalDocumentKey(parseDocument("529.982.247-25")!)).toBe("52998224725");
    const root = "11222333";
    const matriz = parseDocument(randomCnpj({ root, branch: "0001" }))!;
    const filial = parseDocument(randomCnpj({ root, branch: "0002" }))!;
    expect(matriz.digits).not.toBe(filial.digits);
    expect(canonicalDocumentKey(matriz)).toBe(root);
    expect(canonicalDocumentKey(filial)).toBe(root);
  });
});
