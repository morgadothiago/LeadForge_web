import { safeErrorForLog } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { processBillingEvent } from "./process-event";

/**
 * SPEC-053a (D-053-1, item 5) — efetivacao do cancelamento voluntario ao fim do periodo. Quando
 * `cancelAtPeriodEnd` venceu (`currentPeriodEnd <= now`) e o provedor nao mandou evento (PIX/mock/cartao
 * AbacatePay sem endpoint), este job grava `canceled` pelo MESMO `processBillingEvent`/`status-map.ts`:
 * `canceledAt = now` (ancora dos 90 dias de retencao), org suspensa e e-mail #11 (`subscription-canceled`).
 *
 * Idempotente: `eventId` deterministico por (org, fim do periodo) — reprocessar no proximo tick e `duplicate`
 * (e depois o filtro por status deixa de selecionar a org). Isolado: falha por org nunca derruba o tick.
 */
export interface CancelEffectuationResult {
  effectuated: number;
  errors: number;
}

export async function runCancelEffectuationJob(now: Date): Promise<CancelEffectuationResult> {
  const result: CancelEffectuationResult = { effectuated: 0, errors: 0 };
  const subs = await prisma.subscription.findMany({
    where: { cancelAtPeriodEnd: true, status: { in: ["trialing", "active", "past_due"] }, currentPeriodEnd: { lte: now } },
    select: { orgId: true, cadence: true, currentPeriodEnd: true, externalCustomerId: true, externalSubscriptionId: true, plan: { select: { key: true } } },
  });
  for (const sub of subs) {
    if (!sub.currentPeriodEnd) continue;
    try {
      const outcome = await processBillingEvent(
        {
          eventId: `app_cancel_effective:${sub.orgId}:${sub.currentPeriodEnd.getTime()}`,
          type: "subscription.canceled",
          orgId: sub.orgId,
          planKey: sub.plan.key,
          cadence: sub.cadence,
          status: "canceled",
          currentPeriodEnd: sub.currentPeriodEnd,
          cancelAtPeriodEnd: false,
          externalCustomerId: sub.externalCustomerId,
          externalSubscriptionId: sub.externalSubscriptionId,
        },
        now,
      );
      if (outcome === "processed") result.effectuated++;
    } catch (e) {
      result.errors++;
      console.error(`[cancel-effective] falha ao efetivar cancelamento da org ${sub.orgId}:`, safeErrorForLog(e));
    }
  }
  return result;
}
