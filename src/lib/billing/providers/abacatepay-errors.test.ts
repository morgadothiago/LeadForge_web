import { describe, expect, it } from "vitest";
import errorFixture from "./__fixtures__/abacatepay/error-422.json";
import { describeUpstreamError, maskSensitive, MAX_ERROR_BODY_CHARS, pathOnly } from "./abacatepay-errors";

const KEY = "abc_live_key_0123456789";
const SECRET = "whsec_super_secret_0123456789abcdef";

describe("describeUpstreamError (SPEC-063, D-063-23)", () => {
  it("formato: METODO path -> status corpo (corpo real de 422 da doc/sandbox preservado)", () => {
    expect(describeUpstreamError({ method: "post", url: "/subscriptions/create", status: 422, body: errorFixture })).toBe(
      `[abacatepay] POST /subscriptions/create -> 422 ${JSON.stringify(errorFixture)}`,
    );
  });

  it("path SEM query (a query pode carregar ids/segredos)", () => {
    expect(pathOnly("/subscriptions/get?id=subs_1&webhookSecret=zzz")).toBe("/subscriptions/get");
    expect(describeUpstreamError({ method: "GET", url: "/subscriptions/get?id=subs_1&webhookSecret=zzz", status: 400, body: "x" })).toBe("[abacatepay] GET /subscriptions/get -> 400 x");
  });

  it("mascara chave de API, webhook secret, Bearer, webhookSecret=, e-mail, CPF/CNPJ e taxId", () => {
    const body = JSON.stringify({
      error: `Bearer ${KEY} falhou; chave ${KEY}; secret ${SECRET}; url https://x.test/hook?webhookSecret=abc123&a=1`,
      customer: { email: "maria@exemplo.com", taxId: "123.456.789-00", cpf: "12345678900", cnpj: "12.345.678/0001-90" },
      texto: "CPF 123.456.789-00 e CNPJ 12.345.678/0001-90 e 12345678000190 e 12345678900",
    });
    const out = describeUpstreamError({ method: "POST", url: "/x", status: 400, body, secrets: [KEY, SECRET, undefined] });
    for (const leak of [KEY, SECRET, "maria@exemplo.com", "123.456.789-00", "12345678900", "12.345.678/0001-90", "12345678000190", "abc123"]) expect(out).not.toContain(leak);
    expect(out).toContain("[REDACTED]");
  });

  it("trunca em 500 caracteres de corpo (depois de mascarar: um segredo cortado no meio nao escapa)", () => {
    const body = "a".repeat(480) + SECRET + "b".repeat(100);
    const out = describeUpstreamError({ method: "POST", url: "/x", status: 500, body, secrets: [SECRET] });
    const prefix = "[abacatepay] POST /x -> 500 ";
    expect(out.length - prefix.length).toBeLessThanOrEqual(MAX_ERROR_BODY_CHARS);
    expect(out).not.toContain(SECRET.slice(0, 12));
    expect(describeUpstreamError({ method: "GET", url: "/x", status: 500, body: "z".repeat(5000) })).toBe(`[abacatepay] GET /x -> 500 ${"z".repeat(MAX_ERROR_BODY_CHARS)}`);
  });

  it("nunca recebe/imprime corpo de requisicao nem headers (a assinatura da funcao nem os aceita) e sem resposta vira 'sem-resposta'", () => {
    const out = describeUpstreamError({ method: "POST", url: "/x", status: undefined, body: undefined });
    expect(out).toBe('[abacatepay] POST /x -> sem-resposta ""');
  });

  it("segredo curto (<8) nao e tratado como segredo (nao mascara texto comum)", () => {
    expect(maskSensitive("erro abc no campo", ["abc"])).toBe("erro abc no campo");
  });
});
