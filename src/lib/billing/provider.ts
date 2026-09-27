import type { BillingCadence } from "@prisma/client";

/**
 * SPEC-033 (D-33-5) — interface trocável por env (`PAYMENT_PROVIDER=mock|stripe`, default `mock`).
 * Nenhum chamador (`src/lib/actions/billing.ts`, webhook) sabe qual implementação está ativa — só
 * conversa com este contrato. `getPaymentProvider()` (`provider-factory.ts`) resolve a implementação.
 */

export interface CheckoutSessionInput {
  orgId: string;
  planKey: string;
  cadence: BillingCadence;
  /** E-mail do owner da org (prefill no checkout externo). */
  customerEmail: string;
  /** Para onde o checkout redireciona ao concluir/cancelar (a UI de destino é da SPEC-034). */
  successUrl: string;
  cancelUrl: string;
  /**
   * SPEC-047 (D-047-1) — só usado pelo adapter AbacatePay (HÍBRIDO: cartão OU PIX escolhidos no
   * checkout). Ignorado por `mock`/`stripe` (default `"card"` quando ausente). "card" = recorrência
   * REAL gerenciada pelo provedor (`subscriptions/create`); "pix" = cobrança avulsa
   * (`transparents/create`) com renovação controlada pelo LeadForge (`src/lib/billing/pix-renewal.ts`).
   */
  method?: "card" | "pix";
}

export interface CheckoutSessionResult {
  /** URL para o cliente ser redirecionado (checkout externo real; no mock, já volta como "concluído"). */
  url: string;
  sessionId: string;
  /**
   * SPEC-047 (D-047-1) — só preenchido pelo adapter AbacatePay quando `method: "pix"`: dados do QR/copia-e-cola
   * (`transparents/create`). Sem página hospedada de checkout para redirecionar (diferente do fluxo "card"/Stripe)
   * — a UI que for consumir isso (fora do escopo desta SPEC) precisa renderizar o QR/código em vez de redirecionar.
   */
  pix?: { chargeId: string; brCode: string; brCodeBase64: string; expiresAt: Date };
}

export interface PortalSessionInput {
  orgId: string;
  returnUrl: string;
}

export interface PortalSessionResult {
  url: string;
}

/** Vocabulário PRÓPRIO (não o nome literal do evento do provedor) — igual para mock e Stripe. */
export type BillingEventType = "subscription.created" | "subscription.updated" | "subscription.canceled" | "payment.failed" | "payment.recovered";

export interface ParsedBillingEvent {
  /** Idempotência: único GLOBALMENTE (gerado pelo provedor — Stripe já garante unicidade global; o mock gera com `crypto.randomUUID()`). */
  eventId: string;
  type: BillingEventType;
  orgId: string;
  planKey: string;
  cadence: BillingCadence;
  status: "trialing" | "active" | "past_due" | "canceled" | "incomplete";
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  externalCustomerId: string | null;
  externalSubscriptionId: string | null;
}

export interface PaymentProvider {
  readonly name: "mock" | "stripe" | "abacatepay";
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult>;
  createPortalSession(input: PortalSessionInput): Promise<PortalSessionResult>;
  /** `false` = 401 no Route Handler. Mock: sempre `true` (sem assinatura externa a validar, D-33-5). */
  verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean;
  /** `null` = payload não reconhecido (ignorado, 200 "ignored" — nunca 500 por evento desconhecido). */
  parseWebhookEvent(rawBody: string): ParsedBillingEvent | null;
}
