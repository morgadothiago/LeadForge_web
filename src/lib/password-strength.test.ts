import { describe, expect, it } from "vitest";
import { scorePassword } from "./password-strength";

describe("scorePassword (SPEC-064)", () => {
  it("vazio -> nivel 0 sem rotulo", () => {
    expect(scorePassword("")).toEqual({ level: 0, label: "", hint: "" });
  });
  it.each(["123456", "password", "senha123", "Senha123", "qwerty", "123456789", "password99!"])("comum %s -> muito fraca", (p) => {
    const r = scorePassword(p);
    expect(r.level).toBe(1);
    expect(r.label).toBe("Muito fraca");
  });
  it("sequencias e repeticoes -> muito fraca", () => {
    expect(scorePassword("aaaaaa").level).toBe(1);
    expect(scorePassword("abcdefgh").level).toBe(1);
    expect(scorePassword("987654").level).toBe(1);
    expect(scorePassword("abcabcabc").level).toBe(1);
  });
  it("igual ao e-mail ou ao nome (ou parte do e-mail) -> muito fraca com dica", () => {
    expect(scorePassword("ana@empresa.com", ["Ana", "ana@empresa.com"]).level).toBe(1);
    expect(scorePassword("Joaquim", ["Joaquim Silva", ""]).level).toBe(1);
    expect(scorePassword("maria123", ["x", "maria@x.com"]).hint).toMatch(/nome ou e-mail/);
    expect(scorePassword("xK9#mQ2$vL7p", ["Ana", "ana@x.com"]).level).toBe(4);
  });
  it("curta e simples -> fraca; razoavel; forte", () => {
    expect(scorePassword("bolo42").level).toBeLessThanOrEqual(2);
    expect(scorePassword("gatoPreto7").level).toBeGreaterThanOrEqual(2);
    expect(scorePassword("Tr0ca-Esta-Chave!").level).toBe(4);
  });
  it("mais comprimento e variedade nunca piora o nivel (monotonia basica)", () => {
    const a = scorePassword("laranja").level, b = scorePassword("Laranja8").level, c = scorePassword("Laranja8-azul!").level;
    expect(b).toBeGreaterThanOrEqual(a);
    expect(c).toBeGreaterThanOrEqual(b);
  });
  it("rotulos em PT-BR e dica nunca contem a senha", () => {
    for (const p of ["qwerty", "bolo42", "Laranja8", "Tr0ca-Esta-Chave!"]) {
      const r = scorePassword(p);
      expect(["Muito fraca", "Fraca", "Razoável", "Forte"]).toContain(r.label);
      expect(r.hint).not.toContain(p);
    }
  });
});
