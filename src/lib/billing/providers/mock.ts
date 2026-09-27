import { randomUUID } from "node:crypto";
import type { BillingCadence } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { processBillingEvent } from "../process-event";
import type { CheckoutSessionInput, CheckoutSessionResult, ParsedBillingEvent, PaymentProvider, PortalSessionInput, PortalSessionResult } from "../provider";

const PERIOD_MS: Record<BillingCadence, number> = { monthly: 30 * 24 * 3600_000, yearly: 365 * 24 * 3600_000 };

/**
 * SPEC-033 (D-33-5) — implementação DEFAULT (`PAYMENT_PROVIDER=mock`, sem conta/chaves externas).
 * `createCheckoutSession` marca a `Subscription` como `active` DIRETO (sem gateway externo) e dispara o
 * MESMO `processBillingEvent` que o webhook HTTP real usaria — "exercita o mesmo caminho de código".
 * `verifyWebhookSignature` sempre `true` (não há chamador externo a autenticar em modo mock).
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock" as const;

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const plan = await prisma.plan.findUnique({ where: { key: input.planKey }, select: { key: true, active: true, selfServiceCheckout: true } });
    if (!plan || !plan.active) throw new AppError({ code: "not_found", userMessage: "Plano não encontrado." });
    if (!plan.selfServiceCheckout) throw new AppError({ code: "validation", userMessage: "Este plano não tem checkout self-service. Entre em contato com vendas." });

    const now = new Date();
    const eventId = `mock_evt_${randomUUID()}`;
    const event: ParsedBillingEvent = {
      eventId,
      type: "subscription.created",
      orgId: input.orgId,
      planKey: input.planKey,
      cadence: input.cadence,
      status: "active",
      currentPeriodEnd: new Date(now.getTime() + PERIOD_MS[input.cadence]),
      cancelAtPeriodEnd: false,
      externalCustomerId: `mock_cus_${input.orgId}`,
      externalSubscriptionId: `mock_sub_${randomUUID()}`,
    };
    const result = await processBillingEvent(event, now);
    if (result === "org_not_found") throw new AppError({ code: "not_found", userMessage: "Organização não encontrada." });
    if (result === "plan_not_found") throw new AppError({ code: "not_found", userMessage: "Plano não encontrado." });
    return { url: `${input.successUrl}${input.successUrl.includes("?") ? "&" : "?"}session_id=${eventId}`, sessionId: eventId };
  }

  async createPortalSession(input: PortalSessionInput): Promise<PortalSessionResult> {
    return { url: `${input.returnUrl}${input.returnUrl.includes("?") ? "&" : "?"}portal=mock` };
  }

  verifyWebhookSignature(_rawBody: string, _signatureHeader: string | null): boolean {
    return true;
  }

  parseWebhookEvent(rawBody: string): ParsedBillingEvent | null {
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new AppError({ code: "validation", userMessage: "Payload de webhook inválido." });
    }
    return parseMockEventShape(json);
  }
}

const EVENT_TYPES = new Set(["subscription.created", "subscription.updated", "subscription.canceled", "payment.failed", "payment.recovered"]);
const STATUSES = new Set(["trialing", "active", "past_due", "canceled", "incomplete"]);
const CADENCES = new Set(["monthly", "yearly"]);

/** Validação de forma mínima (sem zod: payload de teste simples, mesmo formato de `ParsedBillingEvent`). */
function parseMockEventShape(json: unknown): ParsedBillingEvent | null {
  if (!json || typeof json !== "object") throw new AppError({ code: "validation", userMessage: "Payload de webhook inválido." });
  const o = json as Record<string, unknown>;
  if (typeof o.eventId !== "string" || !o.eventId) throw new AppError({ code: "validation", userMessage: "Payload de webhook inválido." });
  if (typeof o.type !== "string" || !EVENT_TYPES.has(o.type)) return null; // evento reconhecível mas fora do nosso vocabulário -> ignorado
  if (typeof o.orgId !== "string" || !o.orgId) throw new AppError({ code: "validation", userMessage: "Payload de webhook inválido." });
  if (typeof o.planKey !== "string" || !o.planKey) throw new AppError({ code: "validation", userMessage: "Payload de webhook inválido." });
  if (typeof o.status !== "string" || !STATUSES.has(o.status)) throw new AppError({ code: "validation", userMessage: "Payload de webhook inválido." });
  if (typeof o.cadence !== "string" || !CADENCES.has(o.cadence)) throw new AppError({ code: "validation", userMessage: "Payload de webhook inválido." });
  return {
    eventId: o.eventId,
    type: o.type as ParsedBillingEvent["type"],
    orgId: o.orgId,
    planKey: o.planKey,
    cadence: o.cadence as BillingCadence,
    status: o.status as ParsedBillingEvent["status"],
    currentPeriodEnd: typeof o.currentPeriodEnd === "string" ? new Date(o.currentPeriodEnd) : null,
    cancelAtPeriodEnd: o.cancelAtPeriodEnd === true,
    externalCustomerId: typeof o.externalCustomerId === "string" ? o.externalCustomerId : null,
    externalSubscriptionId: typeof o.externalSubscriptionId === "string" ? o.externalSubscriptionId : null,
  };
}
