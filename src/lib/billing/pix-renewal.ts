import { safeErrorForLog } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { processBillingEvent } from "./process-event";
import { getPaymentProvider } from "./provider-factory";
import { AbacatePayPaymentProvider } from "./providers/abacatepay";

/**
 * SPEC-047 (D-047-1) — job de renovação PIX. Só existe porque o AbacatePay não tem recorrência nativa
 * para PIX (só cartão, via `subscriptions/create`): para `Subscription.pixManaged === true`, é o
 * LeadForge (e não o provedor) quem controla o ciclo de cobrança. Chamado pelo tick (SPEC-013/030,
 * `run-tick.ts`), mesmo espírito isolado de `syncOrgStatuses`/`purgeCanceledOrgs`/`sendBillingReminders`
 * (falha nunca derruba o scheduler).
 *
 * NÃO cria um mecanismo de bloqueio paralelo: "PIX vencido sem pagamento" vira um evento de billing comum
 * (`payment.failed`, `status: "past_due"`) processado pelo MESMO `processBillingEvent`/`status-map.ts` que
 * já trata cartão recusado (D-33-3) — grace period de 7 dias, suspensão automática etc. seguem idênticos.
 *
 * Idempotência/correlação (só campos já persistidos na própria `Subscription`, sem estado paralelo):
 * - `pixChargeId`/`pixChargeExpiresAt` guardam a cobrança PENDENTE do ciclo atual (`null` = nenhuma).
 * - Uma cobrança é considerada "resolvida" (paga OU irrelevante) quando `currentPeriodEnd` já avançou
 *   para depois de `pixChargeExpiresAt` — só acontece quando o webhook `transparent.completed`
 *   (`providers/abacatepay.ts`) já processou o pagamento e estendeu `currentPeriodEnd` por um ciclo
 *   inteiro (`CYCLE_MS`, sempre >> a validade curta de um PIX). Isso evita reintroduzir um campo
 *   "pago"/"paid" paralelo: `currentPeriodEnd` (já mantido pelo `processBillingEvent` genérico, que este
 *   job NUNCA contorna) é a única fonte da verdade sobre "o ciclo atual está em dia".
 */

export interface PixRenewalResult {
  generated: number;
  markedPastDue: number;
  errors: number;
}

const ELIGIBLE_STATUSES = ["trialing", "active", "past_due"] as const;

/** `injectedProvider`: só para testes (evita bater na API real do AbacatePay); default resolve via `getPaymentProvider()`, respeitando `PAYMENT_PROVIDER` do env. */
export async function runPixRenewalJob(now: Date, injectedProvider?: AbacatePayPaymentProvider): Promise<PixRenewalResult> {
  const result: PixRenewalResult = { generated: 0, markedPastDue: 0, errors: 0 };
  let provider;
  if (injectedProvider) {
    provider = injectedProvider;
  } else {
    try {
      provider = getPaymentProvider();
    } catch {
      return result; // PAYMENT_PROVIDER=abacatepay mas sem chave configurada -> nada a fazer (mesmo caso "inativo" dos outros jobs de billing).
    }
    if (!(provider instanceof AbacatePayPaymentProvider)) return result; // provider ativo não é AbacatePay -> job inteiro é um no-op.
  }

  const subs = await prisma.subscription.findMany({
    where: { pixManaged: true, status: { in: [...ELIGIBLE_STATUSES] } },
    select: {
      orgId: true, cadence: true, currentPeriodEnd: true, pixChargeId: true, pixChargeExpiresAt: true,
      plan: { select: { key: true } },
      org: { select: { memberships: { where: { orgRole: "owner" }, take: 1, select: { user: { select: { email: true } } } } } },
    },
  });

  for (const sub of subs) {
    try {
      // Cobrança pendente já resolvida (paga - currentPeriodEnd avançou além da validade dela) -> ignora os campos stale.
      const resolved = !!(sub.pixChargeId && sub.pixChargeExpiresAt && sub.currentPeriodEnd && sub.currentPeriodEnd > sub.pixChargeExpiresAt);
      const pendingChargeId = resolved ? null : sub.pixChargeId;
      const pendingExpiresAt = resolved ? null : sub.pixChargeExpiresAt;

      const cycleDue = !sub.currentPeriodEnd || sub.currentPeriodEnd <= now;
      if (!cycleDue) continue; // ciclo atual ainda em dia -> nada a fazer nesta rodada.

      if (pendingChargeId && pendingExpiresAt) {
        if (pendingExpiresAt > now) continue; // cobrança pendente ainda dentro da validade -> aguarda o webhook.
        // Venceu sem pagamento -> equivalente a "cartão recusado" (D-047-1): mesmo mapeamento de status-map.ts,
        // nenhum caminho de bloqueio paralelo. Reusa o eventId da cobrança (idempotente em retry do tick).
        const outcome = await processBillingEvent(
          {
            eventId: `abacatepay_pix_expired_${pendingChargeId}`,
            type: "payment.failed",
            orgId: sub.orgId,
            planKey: sub.plan.key,
            cadence: sub.cadence,
            status: "past_due",
            currentPeriodEnd: sub.currentPeriodEnd,
            cancelAtPeriodEnd: false,
            externalCustomerId: null,
            externalSubscriptionId: pendingChargeId,
          },
          now,
        );
        if (outcome === "processed") result.markedPastDue++;
        await prisma.subscription.update({ where: { orgId: sub.orgId }, data: { pixChargeId: null, pixChargeExpiresAt: null } });
        // E-mail de aviso já é responsabilidade de sendBillingReminders (SPEC-039) lendo o estado past_due -- não duplicado aqui.
        continue; // próxima cobrança (retry) só na próxima rodada do tick, via o ramo abaixo.
      }

      // Nenhuma cobrança pendente válida e o ciclo está vencido -> gera uma nova cobrança PIX para este ciclo.
      const owner = sub.org.memberships[0]?.user.email;
      if (!owner) continue; // sem owner -> não há para quem mandar o PIX (não deveria acontecer fora de dado inconsistente de teste).
      const charge = await provider.createPixCharge({ orgId: sub.orgId, planKey: sub.plan.key, cadence: sub.cadence, customerEmail: owner });
      await prisma.subscription.update({ where: { orgId: sub.orgId }, data: { pixChargeId: charge.chargeId, pixChargeExpiresAt: charge.expiresAt } });
      result.generated++;
    } catch (e) {
      result.errors++;
      console.error(`[pix-renewal] falha ao processar org ${sub.orgId}:`, safeErrorForLog(e));
    }
  }
  return result;
}
