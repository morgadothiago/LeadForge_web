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
  /** SPEC-053 (#12): SO a action `reactivateSubscription` seta isto. Evento externo com `cancelAtPeriodEnd:false` NAO desfaz cancelamento agendado. */
  explicitReactivation?: boolean;
  externalCustomerId: string | null;
  externalSubscriptionId: string | null;
  /** SPEC-052a — dados de pagamento OPCIONAIS (preenchidos quando o provedor informa; recibo cai no preco do `Plan` se `amountCents` ausente, D-052-3). */
  amountCents?: number | null;
  paymentMethod?: "card" | "pix" | null;
  /** So os 4 ultimos digitos do cartao (nunca o numero completo). */
  cardLast4?: string | null;
  /** SPEC-063: bandeira do cartao (ex.: VISA), so para o recibo. */
  cardBrand?: string | null;
  /** Identificador do pagamento/cobranca no provedor (numero do pedido do recibo). */
  externalPaymentId?: string | null;
  paidAt?: Date | null;
}

/** SPEC-053a — cancelamento VOLUNTARIO pela app. `atPeriodEnd=false` = imediato (trial, D-053-3). */
export interface CancelSubscriptionInput {
  orgId: string;
  atPeriodEnd: boolean;
}
export interface CancelSubscriptionResult {
  /**
   * `true` = o provedor confirmou o cancelamento/agendamento (nao havera nova cobranca).
   * `false` = fallback documentado (D-053-5): provedor sem endpoint (AbacatePay cartao) ou assinatura sem
   * recorrencia no provedor (PIX); o LeadForge marca localmente e para de gerar cobranca.
   */
  providerConfirmed: boolean;
}
export interface ResumeSubscriptionInput {
  orgId: string;
}
export interface ResumeSubscriptionResult {
  providerConfirmed: boolean;
}

export interface PaymentProvider {
  readonly name: "mock" | "stripe" | "abacatepay";
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult>;
  createPortalSession(input: PortalSessionInput): Promise<PortalSessionResult>;
  /** SPEC-053a — agenda/efetiva o cancelamento no provedor. Lanca `AppError` se o provedor falhar (a action NAO aplica estado local). */
  cancelSubscription(input: CancelSubscriptionInput): Promise<CancelSubscriptionResult>;
  /** SPEC-053a — desfaz o cancelamento agendado (`cancelAtPeriodEnd`) antes do fim do periodo. */
  resumeSubscription(input: ResumeSubscriptionInput): Promise<ResumeSubscriptionResult>;
  /** `false` = 401 no Route Handler. Mock: sempre `true` (sem assinatura externa a validar, D-33-5). */
  verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean;
  /**
   * `null` = payload não reconhecido (ignorado, 200 "ignored" — nunca 500 por evento desconhecido).
   * SPEC-063 (D-063-12): pode ser assíncrono (AbacatePay correlaciona o pagamento à organização consultando o banco/API); o handler faz `await`.
   */
  parseWebhookEvent(rawBody: string): ParsedBillingEvent | null | Promise<ParsedBillingEvent | null>;
}
