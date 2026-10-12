import type { BillingCadence } from "@prisma/client";
import type { ParsedBillingEvent } from "./provider";

/**
 * SPEC-052a — classe do evento de billing aplicado, decidida comparando o estado ANTERIOR da Subscription
 * (lido na propria transacao de `processBillingEvent`) com o NOVO + `event.type`. Usada para escolher o
 * e-mail e compor a chave de idempotencia (`eventId:<classe>`).
 * 052a envia e-mail so para `activated` e `renewed` (recibo; o `trial_started` foi removido na SPEC-062); `recovered`, `plan_changed`
 * e `payment_failed` sao apenas classificadas (e-mails entram na 052b); `noop` nunca envia.
 */
export type BillingEventClass = "activated" | "renewed" | "recovered" | "plan_changed" | "payment_failed" | "noop";

export interface PriorSubscriptionState {
  status: "trialing" | "active" | "past_due" | "canceled" | "incomplete";
  planId: string;
  cadence: BillingCadence;
  currentPeriodEnd: Date | null;
  /** SPEC-053a: cancelamento agendado antes do evento (detecta transicoes cancelar/reativar). */
  cancelAtPeriodEnd?: boolean;
}

export function classifyBillingEvent(prior: PriorSubscriptionState | null, event: ParsedBillingEvent, newPlanId: string): BillingEventClass {
  if (event.type === "payment.failed" || event.status === "past_due") return "payment_failed";
  // SPEC-062 (D-062-16): sem e-mail/classe de trial; evento externo `trialing` vira noop (so o status e aplicado).
  if (event.status !== "active") return "noop"; // trialing (legado) / canceled (e-mail proprio, SPEC-046) / incomplete
  if (!prior || prior.status !== "active") return prior?.status === "past_due" ? "recovered" : "activated";
  if (prior.planId !== newPlanId || prior.cadence !== event.cadence) return "plan_changed";
  const advanced = !!event.currentPeriodEnd && (!prior.currentPeriodEnd || event.currentPeriodEnd.getTime() > prior.currentPeriodEnd.getTime());
  return advanced ? "renewed" : "noop";
}
