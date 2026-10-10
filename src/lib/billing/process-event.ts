import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withSerializableRetry } from "@/lib/db/tx-conflict";
import { safeErrorForLog } from "@/lib/errors";
import { notifyOrgOwners, absoluteAppUrl } from "@/lib/channels/email/send-once";
import { trialStartedTemplate } from "@/lib/channels/email/templates/trial-started";
import { paymentReceiptTemplate } from "@/lib/channels/email/templates/payment-receipt";
import { subscriptionSuccessTemplate } from "@/lib/channels/email/templates/subscription-success";
import { subscriptionCanceledTemplate } from "@/lib/channels/email/templates/subscription-canceled";
import type { ParsedBillingEvent } from "./provider";
import { classifyBillingEvent, type PriorSubscriptionState } from "./classify-event";
import { computeOrgStatus, TRIAL_DAYS, CANCEL_RETENTION_MS } from "./status-map";

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
  if (!org) return "org_not_found";
  const plan = await prisma.plan.findUnique({
    where: { key: event.planKey },
    select: { id: true, name: true, priceMonthlyCents: true, priceYearlyCents: true },
  });
  if (!plan) return "plan_not_found";

  try {
    const { canceledAt, prior, trialEndsAt: appliedTrialEndsAt } = await withSerializableRetry(
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

            const existing = await tx.subscription.findUnique({ where: { orgId: event.orgId }, select: { pastDueSince: true, canceledAt: true, trialEndsAt: true, status: true, planId: true, cadence: true, currentPeriodEnd: true } });
            const prior: PriorSubscriptionState | null = existing ? { status: existing.status, planId: existing.planId, cadence: existing.cadence, currentPeriodEnd: existing.currentPeriodEnd } : null;
            const pastDueSince = event.status === "past_due" ? (existing?.pastDueSince ?? now) : null;
            const canceledAt = event.status === "canceled" ? (existing?.canceledAt ?? now) : null;
            const trialEndsAt = event.status === "trialing" ? (existing?.trialEndsAt ?? new Date(now.getTime() + TRIAL_DAYS * 24 * 3600_000)) : (existing?.trialEndsAt ?? null);

            const data = {
              planId: plan.id,
              status: event.status,
              cadence: event.cadence,
              currentPeriodEnd: event.currentPeriodEnd,
              cancelAtPeriodEnd: event.cancelAtPeriodEnd,
              externalCustomerId: event.externalCustomerId,
              externalSubscriptionId: event.externalSubscriptionId,
              pastDueSince,
              canceledAt,
              trialEndsAt,
            };
            await tx.subscription.upsert({ where: { orgId: event.orgId }, create: { orgId: event.orgId, ...data }, update: data });

            const orgStatus = computeOrgStatus({ status: event.status, pastDueSince }, now);
            await tx.organization.update({ where: { id: event.orgId }, data: { status: orgStatus } });

            return { canceledAt, prior, trialEndsAt };
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
      if (cls === "trial_started") {
        // Mesma chave do e-mail de signup (`trial_started:<orgId>`): nunca 2 avisos de trial por org.
        const { subject, html, text } = trialStartedTemplate({ planName: plan.name, trialEndsAt: appliedTrialEndsAt, link: absoluteAppUrl("/dashboard") });
        await notifyOrgOwners({ orgId: event.orgId, subject, html, text, scenario: "trial_started", dedupeKey: `trial_started:${event.orgId}` });
      } else if (cls === "activated") {
        const { subject, html, text } = subscriptionSuccessTemplate({ planName: plan.name, amountCents: event.amountCents ?? planAmount ?? null, nextBillingDate: event.currentPeriodEnd });
        await notifyOrgOwners({ orgId: event.orgId, subject, html, text, scenario: "subscription_success", dedupeKey: `${event.eventId}:activated` });
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
            periodStart,
            periodEnd: event.currentPeriodEnd,
            orderId: event.externalPaymentId,
            link: absoluteAppUrl("/configuracoes/assinatura"),
          });
          await notifyOrgOwners({ orgId: event.orgId, subject, html, text, scenario: "payment_receipt", dedupeKey: `${event.eventId}:receipt` });
        }
      }
      if (event.status === "canceled" && canceledAt) {
        const purgeDate = new Date(canceledAt.getTime() + CANCEL_RETENTION_MS);
        const { subject, html, text } = subscriptionCanceledTemplate({
          planName: plan.name,
          accessUntil: event.currentPeriodEnd,
          purgeDate,
        });
        await notifyOrgOwners({ orgId: event.orgId, subject, html, text, scenario: "subscription_canceled", dedupeKey: `${event.eventId}:canceled` });
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
