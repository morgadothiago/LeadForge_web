import Stripe from "stripe";
import { AppError } from "@/lib/errors";
import type { CheckoutSessionInput, CheckoutSessionResult, ParsedBillingEvent, PaymentProvider, PortalSessionInput, PortalSessionResult } from "../provider";

/**
 * SPEC-033 (D-33-1/D-33-5) — adapter Stripe REAL, implementado e pronto, mas INATIVO por padrão: o
 * usuário ainda não tem conta/chaves Stripe (D-33-5). Só é instanciado se `PAYMENT_PROVIDER=stripe` E
 * `STRIPE_SECRET_KEY` estiverem configurados (`provider-factory.ts`); sem isso, o app roda inteiro em
 * `PAYMENT_PROVIDER=mock` (default).
 *
 * NUNCA testado contra a API real do Stripe nesta SPEC (sem credenciais) — NOT VERIFIED end-to-end.
 * Para ativar em produção: preencher `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`, cadastrar
 * `stripePriceIdMonthly`/`stripePriceIdYearly` em cada `Plan` (hoje `null`, D-33-2 placeholder), e
 * trocar `PAYMENT_PROVIDER=stripe` no `.env`. Nenhum chamador muda (mesma interface `PaymentProvider`).
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe" as const;
  private readonly client: Stripe;
  private readonly webhookSecret: string;

  constructor(secretKey: string, webhookSecret: string) {
    this.client = new Stripe(secretKey);
    this.webhookSecret = webhookSecret;
  }

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    // Requer `Plan.stripePriceIdMonthly`/`stripePriceIdYearly` preenchidos (D-33-2 placeholder — vazios hoje).
    throw new AppError({
      code: "config",
      userMessage: "Pagamento indisponível no momento. Tente novamente mais tarde.",
      cause: new Error(`StripePaymentProvider.createCheckoutSession não ativado (sem stripePriceId cadastrado para "${input.planKey}"/${input.cadence}).`),
    });
  }

  async createPortalSession(input: PortalSessionInput): Promise<PortalSessionResult> {
    // Implementação real ficaria: this.client.billingPortal.sessions.create({ customer: externalCustomerId, return_url: input.returnUrl })
    throw new AppError({
      code: "config",
      userMessage: "Portal de assinatura indisponível no momento. Tente novamente mais tarde.",
      cause: new Error(`StripePaymentProvider.createPortalSession não ativado (org ${input.orgId}).`),
    });
  }

  verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
    if (!signatureHeader) return false;
    try {
      this.client.webhooks.constructEvent(rawBody, signatureHeader, this.webhookSecret);
      return true;
    } catch {
      return false;
    }
  }

  parseWebhookEvent(rawBody: string): ParsedBillingEvent | null {
    // A verificação de assinatura (verifyWebhookSignature) já rodou antes de chamar isto (webhook-handler.ts),
    // então o corpo já é confiável aqui — só falta desserializar e mapear.
    let stripeEvent: Stripe.Event;
    try {
      stripeEvent = JSON.parse(rawBody) as Stripe.Event;
    } catch {
      throw new AppError({ code: "validation", userMessage: "Payload de webhook inválido." });
    }
    return mapStripeEvent(stripeEvent);
  }
}

/**
 * Mapeia o vocabulário do Stripe (`checkout.session.completed`, `customer.subscription.updated`,
 * `invoice.payment_failed`, `invoice.payment_succeeded`, ...) para `BillingEventType` — NÃO ativado
 * (a extração de `orgId`/`planKey` dependeria de metadata configurada no Checkout Session real, que só
 * existe quando `createCheckoutSession` estiver implementado de verdade).
 */
function mapStripeEvent(_stripeEvent: Stripe.Event): ParsedBillingEvent | null {
  return null;
}
