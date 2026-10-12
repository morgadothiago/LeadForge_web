import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { getPaymentProvider, resetPaymentProviderCache } from "./provider-factory";

// SPEC-062 (D-062-23 / Q-062-7): trava do provedor mock em producao.
describe("getPaymentProvider - trava do mock em producao", () => {
  beforeEach(() => resetPaymentProviderCache());

  it("mock padrao fora de producao continua funcionando", () => {
    expect(getPaymentProvider({}).name).toBe("mock");
    resetPaymentProviderCache();
    expect(getPaymentProvider({ NODE_ENV: "development", VERCEL_ENV: "preview", PAYMENT_PROVIDER: "mock" }).name).toBe("mock");
  });

  it.each([{ NODE_ENV: "production" }, { VERCEL_ENV: "production" }, { NODE_ENV: "production", PAYMENT_PROVIDER: "mock" }])(
    "recusa mock em producao com erro config em PT-BR (%o)",
    (env) => {
      let err: unknown;
      try {
        getPaymentProvider(env);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("config");
      expect((err as AppError).userMessage).toBe("Pagamento indisponível no momento. Tente novamente mais tarde.");
    },
  );

  it("nao fica em cache apos recusar (proxima chamada recusa de novo)", () => {
    expect(() => getPaymentProvider({ NODE_ENV: "production" })).toThrow(AppError);
    expect(() => getPaymentProvider({ NODE_ENV: "production" })).toThrow(AppError);
  });

  it("ALLOW_MOCK_BILLING=true e a excecao explicita; outros valores nao valem", () => {
    expect(() => getPaymentProvider({ NODE_ENV: "production", ALLOW_MOCK_BILLING: "1" })).toThrow(AppError);
    expect(() => getPaymentProvider({ VERCEL_ENV: "production", ALLOW_MOCK_BILLING: "false" })).toThrow(AppError);
    expect(getPaymentProvider({ NODE_ENV: "production", ALLOW_MOCK_BILLING: "true" }).name).toBe("mock");
  });

  it("provedores reais nao sao afetados em producao", () => {
    expect(getPaymentProvider({ NODE_ENV: "production", PAYMENT_PROVIDER: "abacatepay", ABACATEPAY_API_KEY: "k", ABACATEPAY_WEBHOOK_SECRET: "s".repeat(32) }).name).toBe("abacatepay");
  });
});
