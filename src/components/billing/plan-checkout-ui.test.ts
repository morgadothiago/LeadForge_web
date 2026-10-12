// @vitest-environment node
import { describe, expect, it } from "vitest";
import { withoutCodeKey, POLL_INTERVAL_MS, POLL_MAX_MS, checkoutErrorInfo, resolveCadence, resolveIntentPlan, resolveReturnView, shouldKeepPolling } from "./plan-checkout-ui";
import { pendingBannerCta, pendingBannerMessage } from "./billing-format";

describe("resolveCadence / resolveIntentPlan (?plan=&cadence=)", () => {
  it("cadencia invalida/ausente cai em mensal", () => {
    expect(resolveCadence("yearly")).toBe("yearly");
    expect(resolveCadence("monthly")).toBe("monthly");
    expect(resolveCadence("xpto")).toBe("monthly");
    expect(resolveCadence(undefined)).toBe("monthly");
  });
  it("plano de intencao so vale se self-service e existente; senao ignorado (nunca erro)", () => {
    const plans = [
      { key: "starter", selfServiceCheckout: true },
      { key: "business", selfServiceCheckout: false },
    ];
    expect(resolveIntentPlan("starter", plans)).toBe("starter");
    expect(resolveIntentPlan("business", plans)).toBeNull();
    expect(resolveIntentPlan("courtesy", plans)).toBeNull();
    expect(resolveIntentPlan(undefined, plans)).toBeNull();
  });
});

describe("checkoutErrorInfo (erros tipados de startPlanCheckout)", () => {
  it.each([
    ["email_unverified", /Confirme seu e-mail/],
    ["plan_unavailable", /não está disponível/],
    ["rate_limited", /Muitas tentativas/],
    ["billing_unavailable", /Pagamento indisponível/],
  ])("%s", (code, title) => {
    const info = checkoutErrorInfo({ _form: ["texto do servidor"], code: [code] });
    expect(info.code).toBe(code);
    expect(info.title).toMatch(title);
  });
  it("desconhecido usa a mensagem do servidor", () => {
    const info = checkoutErrorInfo({ _form: ["algo deu errado"] });
    expect(info.code).toBe("unknown");
    expect(info.message).toBe("algo deu errado");
  });
  it("billing_unavailable garante que nenhuma cobranca foi feita", () => {
    expect(checkoutErrorInfo({ code: ["billing_unavailable"] }).message).toMatch(/Nenhuma cobrança/);
  });
});

describe("resolveReturnView (polling do retorno, D-062-11)", () => {
  const ok = { timedOut: false, requestFailed: false };
  it("sem resposta ainda: confirmando (nunca libera por conta propria)", () => {
    expect(resolveReturnView(null, ok)).toBe("confirming");
  });
  it("incomplete: confirmando; depois do tempo, timeout", () => {
    expect(resolveReturnView("incomplete", ok)).toBe("confirming");
    expect(resolveReturnView("incomplete", { timedOut: true, requestFailed: false })).toBe("timeout");
  });
  it("active libera; past_due/canceled = falha; none = sem pagamento", () => {
    expect(resolveReturnView("active", ok)).toBe("paid");
    expect(resolveReturnView("past_due", ok)).toBe("failed");
    expect(resolveReturnView("canceled", ok)).toBe("failed");
    expect(resolveReturnView("none", ok)).toBe("none");
  });
  it("falha de consulta sem status = erro", () => {
    expect(resolveReturnView(null, { timedOut: false, requestFailed: true })).toBe("error");
  });
  it("incomplete seguido de falha de consulta (rede/5xx/sessao): erro com retry, nunca spinner eterno", () => {
    expect(resolveReturnView("incomplete", { timedOut: false, requestFailed: true })).toBe("error");
    expect(resolveReturnView("incomplete", { timedOut: true, requestFailed: true })).toBe("error");
    expect(shouldKeepPolling(resolveReturnView("incomplete", { timedOut: false, requestFailed: true }))).toBe(false);
  });
  it("sucesso depois do retry limpa a falha (requestFailed=false volta ao status real)", () => {
    expect(resolveReturnView("incomplete", ok)).toBe("confirming");
    expect(resolveReturnView("active", ok)).toBe("paid");
  });
  it("so continua consultando enquanto confirmando; intervalo 3s ate ~3min", () => {
    expect(shouldKeepPolling("confirming")).toBe(true);
    for (const v of ["paid", "failed", "none", "timeout", "error"] as const) expect(shouldKeepPolling(v)).toBe(false);
    expect(POLL_INTERVAL_MS).toBe(3000);
    expect(POLL_MAX_MS).toBe(180_000);
  });
});

describe("pendingBannerMessage (ramo legado de trial vencido)", () => {
  it("trial vencido: texto proprio; sem trial: textos de sempre", () => {
    expect(pendingBannerMessage("suspended", true)).toMatch(/período de teste terminou/);
    expect(pendingBannerCta(true)).toBe("Escolher um plano");
    expect(pendingBannerMessage("suspended", false)).toMatch(/pagamento pendente/);
    expect(pendingBannerMessage("cancelled", false)).toMatch(/cancelada/);
    expect(pendingBannerCta(false)).toBe("Regularizar assinatura");
  });
});

describe("withoutCodeKey", () => {
  it("remove so a chave tecnica code", () => {
    expect(withoutCodeKey({ _form: ["Voce ainda nao tem um plano pago."], code: ["no_paid_plan"] })).toEqual({ _form: ["Voce ainda nao tem um plano pago."] });
    expect(withoutCodeKey({ name: ["x"] })).toEqual({ name: ["x"] });
  });
});
