import { notifyOrgOwners, absoluteAppUrl } from "@/lib/channels/email/send-once";
import { paymentFailedTemplate } from "@/lib/channels/email/templates/payment-failed";
import { PAST_DUE_GRACE_MS } from "./status-map";

/**
 * SPEC-052b — e-mail D+0 de falha de cobranca. Chamado por DOIS caminhos que compartilham a MESMA chave de
 * dedupe por episodio de past_due (`payment_failed:<orgId>:<pastDueSince>`): o evento `payment.failed`
 * (`process-event.ts`, imediato) e o fallback `past_due_started` do job (`reminders.ts`). Quem chegar
 * primeiro envia; o outro cai em "duplicate" (sem e-mail repetido, inclusive em corrida/reentrega/retry).
 */
export function pastDueEpisodeKey(orgId: string, pastDueSince: Date): string {
  return `payment_failed:${orgId}:${pastDueSince.toISOString()}`;
}

export interface NotifyPaymentFailedInput {
  orgId: string;
  planName: string;
  pastDueSince: Date;
  amountCents?: number | null;
  paymentMethod?: "card" | "pix" | null;
  cardLast4?: string | null;
}

/** Best-effort: nunca lanca (notifyOrgOwners ja garante). */
export async function notifyPaymentFailed(i: NotifyPaymentFailedInput): Promise<void> {
  const { subject, html, text } = paymentFailedTemplate({
    step: "d0",
    planName: i.planName,
    amountCents: i.amountCents ?? null,
    paymentMethod: i.paymentMethod ?? null,
    cardLast4: i.cardLast4,
    suspendDate: new Date(i.pastDueSince.getTime() + PAST_DUE_GRACE_MS),
    link: absoluteAppUrl("/configuracoes/assinatura"),
  });
  await notifyOrgOwners({ orgId: i.orgId, subject, html, text, scenario: "payment_failed", dedupeKey: pastDueEpisodeKey(i.orgId, i.pastDueSince) });
}
