import { AppError } from "@/lib/errors";
import { MockPaymentProvider } from "./providers/mock";
import { StripePaymentProvider } from "./providers/stripe";
import { AbacatePayPaymentProvider } from "./providers/abacatepay";
import type { PaymentProvider } from "./provider";

/**
 * SPEC-033 (D-33-5) / SPEC-047 — único ponto que decide qual `PaymentProvider` está ativo (`PAYMENT_PROVIDER`,
 * default `mock`; `stripe` e `abacatepay` são as outras 2 opções). Chamadores (`src/lib/actions/billing.ts`,
 * webhook) nunca importam `providers/mock.ts`/`providers/stripe.ts`/`providers/abacatepay.ts` diretamente —
 * sempre passam por aqui, para trocar de provedor só mudando env.
 */
let cached: PaymentProvider | undefined;

export function getPaymentProvider(env: Record<string, string | undefined> = process.env): PaymentProvider {
  if (cached) return cached;
  const name = env.PAYMENT_PROVIDER === "stripe" ? "stripe" : env.PAYMENT_PROVIDER === "abacatepay" ? "abacatepay" : "mock";
  if (name === "mock") return (cached = new MockPaymentProvider());
  if (name === "abacatepay") {
    const apiKey = env.ABACATEPAY_API_KEY;
    const webhookSecret = env.ABACATEPAY_WEBHOOK_SECRET;
    if (!apiKey || !webhookSecret) {
      throw new AppError({
        code: "config",
        userMessage: "Pagamento indisponível no momento. Tente novamente mais tarde.",
        cause: new Error("PAYMENT_PROVIDER=abacatepay sem ABACATEPAY_API_KEY/ABACATEPAY_WEBHOOK_SECRET configurados."),
      });
    }
    return (cached = new AbacatePayPaymentProvider({ apiKey, webhookSecret }));
  }
  const secretKey = env.STRIPE_SECRET_KEY;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    throw new AppError({
      code: "config",
      userMessage: "Pagamento indisponível no momento. Tente novamente mais tarde.",
      cause: new Error("PAYMENT_PROVIDER=stripe sem STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET configurados."),
    });
  }
  return (cached = new StripePaymentProvider(secretKey, webhookSecret));
}

/** Só para testes: força a próxima chamada a recriar o provider (ex.: trocar env entre casos). */
export function resetPaymentProviderCache(): void {
  cached = undefined;
}
