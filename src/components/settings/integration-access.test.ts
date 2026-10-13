import { describe, expect, it } from "vitest";
import { integrationAccess } from "./integration-format";
import { toItemView } from "@/lib/integrations/view";

describe("integrationAccess (069d)", () => {
  const none = {};
  it("Evolution e Places: da plataforma, somente leitura", () => {
    expect(integrationAccess("evolution", none).mode).toBe("platform");
    expect(integrationAccess("places", { "llm.byok": true, "ingest.api": true }).mode).toBe("platform");
  });
  it("LLM: sem BYOK a IA e da plataforma; com BYOK o cliente edita, exceto chave gravada pelo admin", () => {
    expect(integrationAccess("llm", none).mode).toBe("platform");
    expect(integrationAccess("llm", { "llm.byok": true }).mode).toBe("editable");
    expect(integrationAccess("llm", { "llm.byok": true }, { managedByPlatform: true }).mode).toBe("platform");
  });
  it("n8n: bloqueado sem ingest.api (com o nome do plano), editavel com ela", () => {
    expect(integrationAccess("n8n", none)).toEqual({ mode: "locked", feature: "ingest.api" });
    expect(integrationAccess("n8n", { "ingest.api": true }).mode).toBe("editable");
  });
});

describe("toItemView (M1 do QA 069c): chave da plataforma nunca devolve URL completa nem dica", () => {
  const base = { id: "i", integration: "evolution" as const, name: "default", hint: "wxyz", baseUrl: "https://evo.exemplo.test/instancia/segredo?token=abc", allowPrivateHost: false, updatedAt: new Date(), lastTestedAt: null, lastTestOk: null, lastTestError: null };
  it("managedByPlatform: baseUrl null, sem hint, so host mascarado", () => {
    const v = toItemView({ ...base, managedByPlatform: true });
    expect(v.baseUrl).toBeNull();
    expect(v.hint).toBe("");
    expect(v.hintDisplay).toBe("");
    expect(v.hostMasked).toBeTruthy();
    expect(JSON.stringify(v)).not.toContain("segredo");
    expect(JSON.stringify(v)).not.toContain("token=abc");
  });
  it("SPEC-069e: managedByPlatform nao expoe lastTestError ao tenant; chave propria mantem", () => {
    const err = "Falha ao conectar em evo.interno:8080 (token=abc)";
    expect(toItemView({ ...base, managedByPlatform: true, lastTestError: err, lastTestedAt: new Date(), lastTestOk: false }).lastTestError).toBeNull();
    expect(toItemView({ ...base, managedByPlatform: false, lastTestError: err, lastTestedAt: new Date(), lastTestOk: false }).lastTestError).toBe(err);
  });
  it("chave do proprio tenant mantem o comportamento (ele digitou a URL)", () => {
    const v = toItemView({ ...base, managedByPlatform: false });
    expect(v.baseUrl).toBe(base.baseUrl);
    expect(v.hintDisplay).toBe("••••wxyz");
  });
});
