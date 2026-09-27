import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withSerializableRetry } from "@/lib/db/tx-conflict";
import { safeErrorForLog } from "@/lib/errors";
import { sendSystemEmail } from "@/lib/channels/system-mail";
import { subscriptionSuccessTemplate } from "@/lib/channels/email/templates/subscription-success";
import { subscriptionCanceledTemplate } from "@/lib/channels/email/templates/subscription-canceled";
import type { ParsedBillingEvent } from "./provider";
import { computeOrgStatus, TRIAL_DAYS, CANCEL_RETENTION_MS } from "./status-map";

export type ProcessBillingEventResult = "processed" | "duplicate" | "org_not_found" | "plan_not_found";

/**
 * SPEC-046 (D-046-3) — best-effort: envia para todo `Membership.orgRole === "owner"` da org. Nunca lança
 * (falha de e-mail nunca derruba o processamento do evento de billing).
 */
async function notifyOwners(orgId: string, subject: string, html: string, text: string, scenario: "subscription_success" | "subscription_canceled"): Promise<void> {
  const owners = await prisma.membership.findMany({ where: { orgId, orgRole: "owner" }, select: { user: { select: { email: true } } } });
  for (const m of owners) {
    try {
      const r = await sendSystemEmail(m.user.email, subject, { html, text }, scenario);
      if (!r.ok) console.error(`[billing-process-event] falha ao enviar e-mail (org ${orgId}, ${scenario}):`, safeErrorForLog(r.error));
    } catch (e) {
      console.error(`[billing-process-event] envio lançou (org ${orgId}, ${scenario}):`, safeErrorForLog(e));
    }
  }
}

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
    const canceledAt = await withSerializableRetry(
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

            const existing = await tx.subscription.findUnique({ where: { orgId: event.orgId }, select: { pastDueSince: true, canceledAt: true, trialEndsAt: true } });
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

            return canceledAt;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      { attempts: 3 },
    );

    // SPEC-046 (D-046-3/cenário novo 2) — best-effort, nunca lança: e-mail é só notificação, nunca trava
    // o processamento do evento (nem mesmo se a própria consulta de owners falhar). Roda DEPOIS da
    // transação já commitada (o commit em si nunca depende de e-mail sair).
    try {
      if (event.status === "active" || event.status === "trialing") {
        const amountCents = event.cadence === "yearly" ? plan.priceYearlyCents : plan.priceMonthlyCents;
        const { subject, html, text } = subscriptionSuccessTemplate({
          planName: plan.name,
          amountCents: amountCents ?? null,
          status: event.status,
          nextBillingDate: event.currentPeriodEnd,
        });
        await notifyOwners(event.orgId, subject, html, text, "subscription_success");
      } else if (event.status === "canceled" && canceledAt) {
        const purgeDate = new Date(canceledAt.getTime() + CANCEL_RETENTION_MS);
        const { subject, html, text } = subscriptionCanceledTemplate({
          planName: plan.name,
          accessUntil: event.currentPeriodEnd,
          purgeDate,
        });
        await notifyOwners(event.orgId, subject, html, text, "subscription_canceled");
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
