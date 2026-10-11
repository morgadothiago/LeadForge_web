import type { SubscriptionStatus } from "@prisma/client";

/**
 * SPEC-053 (D-053-1/3) — regra UNICA que decide se cancelar agora e "agendado" (acesso ate o fim do periodo pago)
 * ou "imediato". Usada pela action `cancelSubscription` e pelo modal (`CancelSubscriptionPanel`), para a promessa
 * mostrada ao usuario nunca divergir do que a action faz.
 * Agendado so para plano pago (active/past_due) com periodo ainda vigente; trial, incomplete, sem periodo,
 * periodo vencido (inclusive past_due vencido) => imediato.
 */
export type CancelMode = "scheduled" | "immediate";

export function cancelModeFor(sub: { status: SubscriptionStatus; currentPeriodEnd: Date | null }, now: Date): CancelMode {
  const paidAndCurrent = (sub.status === "active" || sub.status === "past_due") && !!sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() > now.getTime();
  return paidAndCurrent ? "scheduled" : "immediate";
}
