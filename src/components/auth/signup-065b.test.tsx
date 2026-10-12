// @vitest-environment node
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/actions/billing", () => ({ signUp: vi.fn() }));

import { SignupForm } from "./SignupForm";

/** SPEC-065b (D-065-21/27) — /signup do teste gratis: campos, CPF/CNPJ com mascara, aviso de LGPD, a11y. */
describe("SignupForm (SPEC-065b)", () => {
  const html = renderToStaticMarkup(<SignupForm />);
  it("campos: nome, e-mail, CPF ou CNPJ, senha, confirmar senha e forca; sem empresa nem plano", () => {
    for (const label of ["Nome", "E-mail", "CPF ou CNPJ", "Senha", "Confirmar senha"]) expect(html).toContain(`>${label}`);
    expect(html).toContain('data-testid="password-strength"');
    expect(html).not.toMatch(/Nome da empresa|Plano/);
    expect(html).toContain("Criar conta");
  });
  it("CPF/CNPJ: teclado numerico, sem autocompletar, limite da mascara, exemplo e associado ao aviso de LGPD", () => {
    expect(html).toMatch(/<input[^>]*id="document"[^>]*/);
    const input = /<input[^>]*id="document"[^>]*>/.exec(html)![0];
    expect(input).toContain('inputMode="numeric"');
    expect(input).toContain('autoComplete="off"');
    expect(input).toContain('maxLength="18"');
    expect(input).toContain("000.000.000-00 ou 00.000.000/0000-00");
    expect(input).toContain('aria-describedby="document-hint"');
    expect(html).toContain('id="document-hint"');
  });
  it("aviso de LGPD: so o hash, para limitar o teste a um por pessoa ou empresa (nao diz que consulta a Receita)", () => {
    expect(html).toContain("limitar o teste a um por pessoa ou empresa");
    expect(html).toContain("código irreversível (hash)");
    expect(html).toContain("nunca o número");
    expect(html).not.toMatch(/Receita|consulta/i);
  });
  it("Field keepHint: com erro, o aviso continua visivel e ambos entram no aria-describedby", async () => {
    const { Field } = await import("@/components/campaigns/Field");
    const html = renderToStaticMarkup(<Field id="d" label="L" hint="Aviso LGPD" error="CPF ou CNPJ inválido." keepHint>{(a) => <input {...a} />}</Field>);
    expect(html).toContain("Aviso LGPD");
    expect(html).toContain('aria-describedby="d-error d-hint"');
    const plain = renderToStaticMarkup(<Field id="d" label="L" hint="Aviso LGPD" error="x">{(a) => <input {...a} />}</Field>);
    expect(plain).not.toContain("Aviso LGPD");
  });
  it("botao de envio: area de toque padrao do design system e sem estado de loading no 1o render", () => {
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*aria-busy="false"/);
    expect(html).not.toContain("Criando conta...");
  });
});
