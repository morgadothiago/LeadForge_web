import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withSerializableRetry } from "@/lib/db/tx-conflict";
import { safeErrorForLog } from "@/lib/errors";
import { notifyOrgOwners, absoluteAppUrl } from "@/lib/channels/email/send-once";
import { paymentReceiptTemplate } from "@/lib/channels/email/templates/payment-receipt";
import { subscriptionSuccessTemplate } from "@/lib/channels/email/templates/subscription-success";
import { paymentRecoveredTemplate } from "@/lib/channels/email/templates/payment-recovered";
import { planChangedTemplate } from "@/lib/channels/email/templates/plan-changed";
import { cancelRequestedTemplate } from "@/lib/channels/email/templates/cancel-requested";
import { subscriptionReactivatedTemplate } from "@/lib/channels/email/templates/subscription-reactivated";
import { subscriptionCanceledTemplate } from "@/lib/channels/email/templates/subscription-canceled";
import type { ParsedBillingEvent } from "./provider";
import { classifyBillingEvent, type PriorSubscriptionState } from "./classify-event";
import { notifyPaymentFailed } from "./past-due-email";
import { computeOrgStatus, CANCEL_RETENTION_MS } from "./status-map";

export type ProcessBillingEventResult = "processed" | "duplicate" | "org_not_found" | "plan_not_found";

/**
 * SPEC-033 — único caminho que aplica um evento de billing ao banco (`WebhookEvent` + `Subscription` +
 * `Organization.status`). Usado tanto pelo Route Handler HTTP (`POST /api/billing/webhook`, provedor
 * real) quanto pelo `MockPaymentProvider.createCheckoutSession` (evento disparado internamente, sem HTTP)
 * — "mesmo caminho de código" exigido por D-33-5.
 *
 * Idempotência: `WebhookEvent.eventId` é `@unique` GLOBAL no schema (reaproveitado do padrão do webhook
 * do WhatsApp, só muda `source`). `eventId` é sempre gerado pelo PROVEDOR (Stripe garante unicidade
 * global; o mock usa `crypto.randomUUID()`) — nunca inclui dado previsível por org que pudesse colidir
 * entre tenants (o cuidado que já mordeu a SPEC-030 duas vezes). A escrita do `WebhookEvent` é a
 * PRIMEIRA coisa na transação: se colidir, a transação inteira aborta e nada da Subscription/Organization
 * é tocado.
 */
export async function processBillingEvent(event: ParsedBillingEvent, now: Date): Promise<ProcessBillingEventResult> {
  const org = await prisma.organization.findUnique({ where: { id: event.orgId }, select: { id: true } });
  if (!org) {
    // SPEC-062 (D-062-18): pagamento para org inexistente (ex.: casca apagada cedo) — linha estruturada, so ids/tipo/status (sem PII), para conciliacao manual.
    console.error(`[billing-orphan-payment] eventId=${event.eventId} orgId=${event.orgId} type=${event.type} status=${event.status}`);
    return "org_not_found";
  }
  const plan = await prisma.plan.findUnique({
    where: { key: event.planKey },
    select: { id: true, name: true, priceMonthlyCents: true, priceYearlyCents: true },
  });
  if (!plan) return "plan_not_found";

  try {
    const { canceledAt, prior, pastDueSince: appliedPastDueSince, cancelAtPeriodEnd: appliedCancelAtPeriodEnd } = await withSerializableRetry(
      () =>
        prisma.$transaction(
          async (tx) => {
            await tx.webhookEvent.create({
              data: {
                source: "billing",
                orgId: event.orgId,
                eventId: event.eventId,
                processedAt: now,
                payload: { type: event.type, planKey: event.planKey, status: event.status },
              },
            });

            const existing = await tx.subscription.findUnique({ where: { orgId: event.orgId }, select: { pastDueSince: true, canceledAt: true, trialEndsAt: true, status: true, planId: true, cadence: true, currentPeriodEnd: true, cancelAtPeriodEnd: true } });
            const prior: PriorSubscriptionState | null = existing ? { status: existing.status, planId: existing.planId, cadence: existing.cadence, currentPeriodEnd: existing.currentPeriodEnd, cancelAtPeriodEnd: existing.cancelAtPeriodEnd } : null;
            const pastDueSince = event.status === "past_due" ? (existing?.pastDueSince ?? now) : null;
            const canceledAt = event.status === "canceled" ? (existing?.canceledAt ?? now) : null;
            // SPEC-062 (D-062-2): nada novo cria trial — `trialEndsAt` so e PRESERVADO (org legada); nunca mais calculado (+14d).
            const trialEndsAt = existing?.trialEndsAt ?? null;

            // SPEC-053 (#12): so a action de reativar desfaz um cancelamento agendado; evento externo com
            // `cancelAtPeriodEnd:false` (ex.: AbacatePay sempre manda false) o preserva. `canceled` efetiva e zera.
            // Periodo ja vencido (job ainda nao efetivou) = nova contratacao legitima: nao preserva.
            const scheduledStillValid = existing?.cancelAtPeriodEnd === true && existing.status !== "canceled" && !!existing.currentPeriodEnd && existing.currentPeriodEnd.getTime() > now.getTime();
            const cancelAtPeriodEnd = event.status !== "canceled" && scheduledStillValid && !event.explicitReactivation ? true : event.cancelAtPeriodEnd;
            const data = {
              planId: plan.id,
              status: event.status,
              cadence: event.cadence,
              currentPeriodEnd: event.currentPeriodEnd,
              cancelAtPeriodEnd,
              externalCustomerId: event.externalCustomerId,
              externalSubscriptionId: event.externalSubscriptionId,
              pastDueSince,
              canceledAt,
              trialEndsAt,
            };
            await tx.subscription.upsert({ where: { orgId: event.orgId }, create: { orgId: event.orgId, ...data }, update: data });

            const orgStatus = computeOrgStatus({ status: event.status, pastDueSince, cancelAtPeriodEnd, currentPeriodEnd: event.currentPeriodEnd, trialEndsAt }, now);
            await tx.organization.update({ where: { id: event.orgId }, data: { status: orgStatus } });

            return { canceledAt, prior, pastDueSince, cancelAtPeriodEnd };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      { attempts: 3 },
    );

    // SPEC-046 (D-046-3/cenário novo 2) — best-effort, nunca lança: e-mail é só notificação, nunca trava
    // o processamento do evento (nem mesmo se a própria consulta de owners falhar). Roda DEPOIS da
    // transação já commitada (o commit em si nunca depende de e-mail sair).
    try {
      // SPEC-052a: classe do evento (estado anterior x novo + type) decide o e-mail; chave `eventId:<classe>`.
      const cls = classifyBillingEvent(prior, event, plan.id);
      const planAmount = event.cadence === "yearly" ? plan.priceYearlyCents : plan.priceMonthlyCents;
      if (cls === "activated") {
        const { subject, html, text } = subscriptionSuccessTemplate({ planName: plan.name, amountCents: event.amountCents ?? planAmount ?? null, nextBillingDate: event.currentPeriodEnd });
        await notifyOrgOwners({ orgId: event.orgId, subject, html, text, scenario: "subscription_success", dedupeKey: `${event.eventId}:activated` });
      } else if (cls === "payment_failed" && appliedPastDueSince) {
        // SPEC-052b: D+0 imediato no evento. Chave por episodio de past_due, compartilhada com o fallback do job.
        await notifyPaymentFailed({ orgId: event.orgId, planName: plan.name, pastDueSince: appliedPastDueSince, amountCents: event.amountCents ?? planAmount ?? null, paymentMethod: event.paymentMethod, cardLast4: event.cardLast4 });
      } else if (cls === "recovered") {
        const { subject, html, text } = paymentRecoveredTemplate({ planName: plan.name, nextBillingDate: event.currentPeriodEnd, link: absoluteAppUrl("/dashboard") });
        await notifyOrgOwners({ orgId: event.orgId, subject, html, text, scenario: "payment_recovered", dedupeKey: `${event.eventId}:recovered` });
      } else if (cls === "plan_changed") {
        // D-052-10: restaura o e-mail de troca de plano (regressao D-046-3 da 052a).
        const previous = prior ? await prisma.plan.findUnique({ where: { id: prior.planId }, select: { name: true } }) : null;
        const { subject, html, text } = planChangedTemplate({ previousPlanName: previous?.name ?? null, planName: plan.name, cadence: event.cadence, amountCents: event.amountCents ?? planAmount ?? null, nextBillingDate: event.currentPeriodEnd, link: absoluteAppUrl("/configuracoes/assinatura") });
        await notifyOrgOwners({ orgId: event.orgId, subject, html, text, scenario: "plan_changed", dedupeKey: `${event.eventId}:plan_changed` });
      }
      // Recibo: renovacao (cartao/PIX) ou qualquer PIX pago (`transparent.completed` carrega paymentMethod "pix").
      if (cls === "renewed" || ((cls === "activated" || cls === "recovered" || cls === "plan_changed") && event.paymentMethod === "pix")) {
        // D-052-3: sem valor do provedor, cai no preco do plano (`amountFromPlan`, so interno).
        const amountFromPlan = event.amountCents == null;
        const amountCents = event.amountCents ?? planAmount ?? null;
        if (amountCents !== null) {
          if (amountFromPlan) console.info(`[billing-process-event] recibo com valor do plano (amountFromPlan) org ${event.orgId}`);
          const paidAt = event.paidAt ?? now;
          const periodStart = prior?.currentPeriodEnd && event.currentPeriodEnd && prior.currentPeriodEnd < event.currentPeriodEnd ? prior.currentPeriodEnd : paidAt;
          const { subject, html, text } = paymentReceiptTemplate({
            planName: plan.name,
            amountCents,
            paidAt,
            paymentMethod: event.paymentMethod ?? null,
            cardLast4: event.cardLast4,
            cardBrand: event.cardBrand,
            periodStart,
            periodEnd: event.currentPeriodEnd,
            orderId: event.externalPaymentId,
            link: absoluteAppUrl("/configuracoes/assinatura"),
          });
          await notifyOrgOwners({ orgId: event.orgId, subject, html, text, scenario: "payment_receipt", dedupeKey: event.externalPaymentId ? `payment:${event.externalPaymentId}:receipt` : `${event.eventId}:receipt` });
        }
      }
      if (event.status === "canceled" && canceledAt) {
        // SPEC-053 (D-053-1): `canceled` suspende na hora (computeOrgStatus) — o e-mail afirma acesso ENCERRADO.
        // Retencao de 90 dias conta da efetivacao (`canceledAt`). Cancelamento voluntario ao fim do periodo chega
        // aqui pelo job de efetivacao (`cancel-effective.ts`), com `canceledAt` = quando efetivou.
        const purgeDate = new Date(canceledAt.getTime() + CANCEL_RETENTION_MS);
        const accessEndedAt = event.currentPeriodEnd && event.currentPeriodEnd.getTime() < canceledAt.getTime() ? event.currentPeriodEnd : canceledAt;
        const { subject, html, text } = subscriptionCanceledTemplate({
          planName: plan.name,
          accessEndedAt,
          purgeDate,
          link: absoluteAppUrl("/configuracoes/assinatura"),
        });
        await notifyOrgOwners({ orgId: event.orgId, subject, html, text, scenario: "subscription_canceled", dedupeKey: `${event.eventId}:canceled` });
      }
      // SPEC-053a (#10): cancelamento agendado (false -> true) com acesso mantido ate `currentPeriodEnd`.
      // Chave `cancel_requested:<orgId>:<cancelRequestedAt>` (= `now` do evento, ja unico por eventId).
      if (event.status !== "canceled" && appliedCancelAtPeriodEnd && !prior?.cancelAtPeriodEnd && event.currentPeriodEnd) {
        const { subject, html, text } = cancelRequestedTemplate({
          planName: plan.name,
          accessUntil: event.currentPeriodEnd,
          purgeDate: new Date(event.currentPeriodEnd.getTime() + CANCEL_RETENTION_MS),
          link: absoluteAppUrl("/configuracoes/assinatura"),
        });
        await notifyOrgOwners({ orgId: event.orgId, subject, html, text, scenario: "cancel_requested", dedupeKey: `cancel_requested:${event.orgId}:${now.toISOString()}` });
      }
      // SPEC-053a (#12): cancelamento agendado desfeito antes do fim do periodo (true -> false, sem ter efetivado).
      if (event.status !== "canceled" && event.status !== "incomplete" && !appliedCancelAtPeriodEnd && prior?.cancelAtPeriodEnd && prior.status !== "canceled") {
        const { subject, html, text } = subscriptionReactivatedTemplate({ planName: plan.name, nextBillingDate: event.currentPeriodEnd, link: absoluteAppUrl("/dashboard") });
        await notifyOrgOwners({ orgId: event.orgId, subject, html, text, scenario: "subscription_reactivated", dedupeKey: `reactivated:${event.orgId}:${now.toISOString()}` });
      }
    } catch (e) {
      console.error(`[billing-process-event] falha ao notificar owners por e-mail (org ${event.orgId}):`, safeErrorForLog(e));
    }

    return "processed";
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "duplicate";
    throw e;
  }
}
