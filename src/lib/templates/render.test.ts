import { describe, expect, it } from "vitest";
import { renderTemplate } from "./render";

describe("renderTemplate", () => {
  it("substitui variáveis (com espaços)", () => {
    const r = renderTemplate("Oi {{name}} da {{ company }}", { name: "Ana", company: "X" });
    expect(r).toEqual({ ok: true, text: "Oi Ana da X", missing: [] });
  });
  it("variável desconhecida é erro", () => {
    expect(renderTemplate("Oi {{nome}} {{foo}}", { name: "A" })).toEqual({ ok: false, unknown: ["nome", "foo"] });
  });
  it("variável ausente vira vazio e é reportada", () => {
    const r = renderTemplate("Oi {{name}} ({{company}})", { name: "A", company: null });
    expect(r).toEqual({ ok: true, text: "Oi A ()", missing: ["company"] });
  });
  it("sem injeção: valor com {{x}} não é reprocessado", () => {
    const r = renderTemplate("Oi {{name}}", { name: "{{email}}", email: "s@x.com" });
    expect(r).toEqual({ ok: true, text: "Oi {{email}}", missing: [] });
  });
  it("subject sem quebra de linha (header injection)", () => {
    const r = renderTemplate("Olá {{name}}\r\nBcc: x@y.com", { name: "A\r\nBcc: z@y.com" }, { channel: "email", field: "subject" });
    expect(r.ok && r.text).not.toMatch(/[\r\n]/);
  });
  it("body remove controles e normaliza CRLF", () => {
    const r = renderTemplate("{{name}}", { name: "a\u0000b\r\nc" }, { field: "body" });
    expect(r.ok && r.text).toBe("ab\nc");
  });
  it("texto sem variáveis passa igual", () => {
    expect(renderTemplate("oi", {})).toEqual({ ok: true, text: "oi", missing: [] });
  });
});
