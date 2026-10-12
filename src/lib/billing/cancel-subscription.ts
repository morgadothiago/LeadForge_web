import { randomUUID } from "node:crypto";
import type { SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SlidingLimiter } from "@/lib/integrations/rate-limit";
import { getPaymentProvider } from "./provider-factory";
import { processBillingEvent } from "./process-event";
import { cancelModeFor } from "./cancel-mode";
import { formError, success, type ActionResult } from "@/lib/actions/result";

/** Estado devolvido ao frontend (053b): `cancelAtPeriodEnd` + `currentPeriodEnd` (fim do acesso) + `status`. */
export interface SubscriptionChangeResult {
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  /** `scheduled` = cancelamento agendado p/ fim do periodo; `immediate` = efetivado agora (trial/sem periodo pago); `already` = nada a fazer (idempotente); `reactivated` = cancelamento agendado desfeito. */
  outcome: "scheduled" | "immediate" | "already" | "reactivated";
}

/** Compartilhado por cancelar/reativar (053) e `cancelPendingSubscription` (062). Vive fora do arquivo "use server" (nao e action). */
export const cancelLimiter = new SlidingLimiter(5, 10 * 60_000, 1000, "billing-cancel");

/**
 * SPEC-053a (D-053-1..6) / SPEC-062 (D-062-20) — miolo do cancelamento de UMA org (a org da sessao para `cancelSubscription`;
 * a casca do usuario para `cancelPendingSubscription`). O chamador ja autorizou (owner). Plano pago em dia: `cancelAtPeriodEnd=true`,
 * acesso ate `currentPeriodEnd`, sem reembolso. Sem periodo pago vigente: efetivo imediato (D-053-3). Provedor primeiro: se
 * FALHAR (lanca), nada e gravado localmente. Estado aplicado pelo MESMO `processBillingEvent`. Idempotente.
 */
export async function cancelSubscriptionForOrg(orgId: string): Promise<ActionResult<SubscriptionChangeResult>> {
  if (await cancelLimiter.hit(orgId) > 0) return formError("Muitas tentativas. Aguarde alguns minutos e tente novamente.");
  const sub = await prisma.subscription.findUnique({
    where: { orgId },
    select: { status: true, cadence: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, externalCustomerId: true, externalSubscriptionId: true, plan: { select: { key: true } } },
  });
  if (!sub) return formError("Nenhuma assinatura encontrada para cancelar.");
  // SPEC-065 (D-065-24): o teste gratis (plano `free`) nao tem o que cancelar; sair = excluir a conta (054).
  if (sub.plan.key === "free") return formError("O teste grátis não tem assinatura para cancelar.");
  if (sub.status === "canceled" || sub.cancelAtPeriodEnd) {
    return success({ status: sub.status, cancelAtPeriodEnd: sub.cancelAtPeriodEnd, currentPeriodEnd: sub.currentPeriodEnd, outcome: "already" });
  }
  const now = new Date();
  const atPeriodEnd = cancelModeFor(sub, now) === "scheduled";
  await getPaymentProvider().cancelSubscription({ orgId, atPeriodEnd });
  const result = await processBillingEvent(
    {
      eventId: `app_cancel:${orgId}:${randomUUID()}`,
      type: atPeriodEnd ? "subscription.updated" : "subscription.canceled",
      orgId,
      planKey: sub.plan.key,
      cadence: sub.cadence,
      status: atPeriodEnd ? sub.status : "canceled",
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: atPeriodEnd,
      externalCustomerId: sub.externalCustomerId,
      externalSubscriptionId: sub.externalSubscriptionId,
    },
    now,
  );
  if (result === "org_not_found" || result === "plan_not_found") return formError("Não foi possível cancelar a assinatura.");
  return success({ status: atPeriodEnd ? sub.status : "canceled", cancelAtPeriodEnd: atPeriodEnd, currentPeriodEnd: sub.currentPeriodEnd, outcome: atPeriodEnd ? "scheduled" : "immediate" });
}
