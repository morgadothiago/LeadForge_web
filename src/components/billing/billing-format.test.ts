import { describe, expect, it } from "vitest";
import { formatBRLCents, limitLabel, priceForCadence, subscriptionStatusTone } from "./billing-format";

describe("formatBRLCents", () => {
  it("formata centavos em BRL", () => {
    expect(formatBRLCents(29_700)).toBe("R$ 297,00");
  });
});

describe("priceForCadence", () => {
  const plan = { priceMonthlyCents: 29_700, priceYearlyCents: 297_000 };
  it("mensal -> priceMonthlyCents", () => {
    expect(priceForCadence(plan, "monthly")).toBe(29_700);
  });
  it("anual -> priceYearlyCents", () => {
    expect(priceForCadence(plan, "yearly")).toBe(297_000);
  });
  it("sem priceYearlyCents (sob consulta) -> null", () => {
    expect(priceForCadence({ priceMonthlyCents: 0, priceYearlyCents: null }, "yearly")).toBeNull();
  });
});

describe("limitLabel", () => {
  it("número -> formata com a unidade", () => {
    expect(limitLabel(3, "campanha(s) ativa(s)")).toBe("3 campanha(s) ativa(s)");
  });
  it("null -> ilimitado", () => {
    expect(limitLabel(null, "campanha(s) ativa(s)")).toBe("campanha(s) ativa(s) ilimitado(s)");
  });
});

describe("subscriptionStatusTone", () => {
  it("active/trialing -> ok", () => {
    expect(subscriptionStatusTone("active")).toBe("ok");
    expect(subscriptionStatusTone("trialing")).toBe("ok");
  });
  it("past_due/incomplete -> warn", () => {
    expect(subscriptionStatusTone("past_due")).toBe("warn");
    expect(subscriptionStatusTone("incomplete")).toBe("warn");
  });
  it("canceled -> bad", () => {
    expect(subscriptionStatusTone("canceled")).toBe("bad");
  });
});
