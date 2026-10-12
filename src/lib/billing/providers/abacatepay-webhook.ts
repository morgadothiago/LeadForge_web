import { createHash } from "node:crypto";
import type { BillingCadence, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import type { ParsedBillingEvent } from "../provider";
import type { AbacateClient } from "./abacatepay-client";

/**
 * SPEC-063 (D-063-11/13/14/15) — parser do webhook v2 do AbacatePay + correlacao pagamento -> organizacao.
 * Fixtures literais da documentacao oficial em `__fixtures__/abacatepay/` (a doc manda NAO validar o payload inteiro com zod:
 * so `event` e lido como obrigatorio; o resto e lido com guardas defensivas, campo novo/ausente nunca quebra).
 *
 * `metadata` NAO aparece nos payloads de webhook documentados — a correlacao nunca depende dele (so como ultimo recurso, via API).
 */

export interface WebhookContext {
  now: Date;
  client: AbacateClient;
  keyFingerprint: string;
}

/** Eventos reconhecidos e SEM efeito nesta entrega (200 `ignored` + log estruturado, sem PII). */
const RECOGNIZED_IGNORED = new Set([
  "subscription.trial_started", "subscription.plan_changed",
  "checkout.completed", "checkout.refunded", "checkout.disputed", "checkout.lost",
  "transparent.refunded", "transparent.disputed", "transparent.lost",
  "payout.completed", "payout.failed", "transfer.completed", "transfer.failed",
]);

const HANDLED = new Set(["subscription.completed", "subscription.renewed", "subscription.payment_failed", "subscription.cancelled", "transparent.completed"]);

const LOCAL_SELECT = {
  orgId: true, status: true, cadence: true, currentPeriodEnd: true, cancelAtPeriodEnd: true,
  externalSubscriptionId: true, externalCustomerId: true, plan: { select: { key: true } },
} as const;
type LocalSub = {
  orgId: string; status: SubscriptionStatus; cadence: BillingCadence; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean;
  externalSubscriptionId: string | null; externalCustomerId: string | null; plan: { key: string };
};
interface Resolved { orgId: string; local: LocalSub | null; via: string }

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const cents = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);
const intOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
function date(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Soma 1 mes/ano de CALENDARIO (UTC), com limite no ultimo dia do mes de destino (31/jan + 1 mes = 28|29/fev). D-063-15. */
export function addCycle(from: Date, cadence: BillingCadence): Date {
  const months = cadence === "yearly" ? 12 : 1;
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(from.getUTCDate(), lastDay), from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()));
}

/** Data de pagamento: usa a do provedor so se for recente (<=2 dias, nao futura; retentativas vao a ~18 h); senao "agora" (replay de fixture/reenvio antigo). */
function recentOrNow(d: Date | null, now: Date): Date {
  if (!d) return now;
  const age = now.getTime() - d.getTime();
  return age >= 0 && age <= 2 * 24 * 3600_000 ? d : now;
}

function orphan(event: string, ids: Record<string, string | null>): null {
  const parts = Object.entries(ids).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(" ");
  console.error(`[billing-orphan-payment] event=${event} ${parts}`);
  return null;
}

async function localByOrg(orgId: string): Promise<LocalSub | null> {
  return prisma.subscription.findUnique({ where: { orgId }, select: LOCAL_SELECT });
}

async function orgExists(orgId: string): Promise<boolean> {
  return !!(await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } }));
}

/** `lf:<orgId>:<attempt>` (checkout de assinatura) ou `lf-pix:<orgId>:...` (cobranca PIX). */
export function orgIdFromExternalId(externalId: string | null | undefined, prefix: "lf" | "lf-pix"): string | null {
  if (!externalId) return null;
  const parts = externalId.split(":");
  return parts[0] === prefix && parts[1] ? parts[1] : null;
}

async function resolveByOrgId(orgId: string, via: string): Promise<Resolved | null> {
  const local = await localByOrg(orgId);
  if (local) return { orgId, local, via };
  return (await orgExists(orgId)) ? { orgId, local: null, via } : null;
}

/** D-063-11: cascata subs_ -> bill_ -> externalId `lf:` -> API (1 par de chamadas, so se os elos locais falharem). */
async function resolveSubscriptionEvent(data: Obj, ctx: WebhookContext): Promise<Resolved | null> {
  const subsId = str(obj(data.subscription).id);
  const checkout = obj(data.checkout);
  const billId = str(checkout.id);

  if (subsId) {
    const l = await prisma.subscription.findFirst({ where: { externalSubscriptionId: subsId }, select: LOCAL_SELECT });
    if (l) return { orgId: l.orgId, local: l, via: "subscription.id" };
  }
  if (billId) {
    const l = await prisma.subscription.findFirst({ where: { externalCheckoutId: billId }, select: LOCAL_SELECT });
    if (l) return { orgId: l.orgId, local: l, via: "checkout.id" };
  }
  const fromExternal = orgIdFromExternalId(str(checkout.externalId), "lf");
  if (fromExternal) {
    const r = await resolveByOrgId(fromExternal, "checkout.externalId");
    if (r) return r;
  }

  // Fallback por API: assinatura -> checkout -> externalId/metadata.
  try {
    let bill = billId;
    if (subsId) {
      const sub = obj(obj(await ctx.client.get("/subscriptions/get", { id: subsId })).data);
      bill = bill ?? str(sub.checkoutId);
      const e = orgIdFromExternalId(str(sub.externalId), "lf");
      if (e) {
        const r = await resolveByOrgId(e, "api.subscription.externalId");
        if (r) return r;
      }
    }
    if (bill) {
      const l = await prisma.subscription.findFirst({ where: { externalCheckoutId: bill }, select: LOCAL_SELECT });
      if (l) return { orgId: l.orgId, local: l, via: "api.checkoutId" };
      const co = obj(obj(await ctx.client.get("/subscriptions/checkouts/get", { id: bill })).data);
      const org = orgIdFromExternalId(str(co.externalId), "lf") ?? str(obj(co.metadata).orgId);
      if (org) return resolveByOrgId(org, "api.checkout");
    }
  } catch (e) {
    console.warn(`[abacatepay-webhook] fallback por API falhou (subs=${subsId ?? "-"} bill=${billId ?? "-"}): ${e instanceof AppError ? e.code : "erro"}`);
  }
  return null;
}

/** `transparent.completed`: `transparent.id` == `Subscription.pixChargeId` (a doc mostra `char_...`, a criacao `pix_char_...`: tenta as duas formas), depois `lf-pix:` do externalId. */
async function resolveTransparentEvent(data: Obj): Promise<Resolved | null> {
  const t = obj(data.transparent);
  const id = str(t.id);
  if (id) {
    const bare = id.replace(/^pix_/, "");
    const l = await prisma.subscription.findFirst({ where: { pixChargeId: { in: [id, bare, `pix_${bare}`] } }, select: LOCAL_SELECT });
    if (l) return { orgId: l.orgId, local: l, via: "transparent.id" };
  }
  const org = orgIdFromExternalId(str(t.externalId), "lf-pix");
  return org ? resolveByOrgId(org, "transparent.externalId") : null;
}

/** `prod_` -> plano + cadencia (reverso do catalogo, D-063-2). */
async function planFromProduct(prodId: string | null, keyFingerprint: string): Promise<{ planKey: string; cadence: BillingCadence } | null> {
  if (!prodId) return null;
  const row = await prisma.billingProduct.findFirst({ where: { provider: "abacatepay", keyFingerprint, providerProductId: prodId }, select: { cadence: true, plan: { select: { key: true } } } });
  return row ? { planKey: row.plan.key, cadence: row.cadence } : null;
}

function paymentFields(data: Obj, fallbackMethod: "card" | "pix") {
  const payer = obj(data.payerInformation);
  const method = payer.method === "PIX" ? "pix" : payer.method === "CARD" ? "card" : fallbackMethod;
  const card = obj(payer.CARD);
  const digits = typeof card.number === "string" ? card.number.replace(/\D/g, "") : "";
  const payment = obj(data.payment);
  return {
    amountCents: cents(payment.paidAmount) ?? cents(payment.amount) ?? cents(obj(data.subscription).amount),
    paymentMethod: method as "card" | "pix",
    cardLast4: method === "card" && digits.length >= 4 ? digits.slice(-4) : null,
    cardBrand: method === "card" ? str(card.brand) : null,
    externalPaymentId: str(payment.id),
    receiptUrl: str(payment.receiptUrl),
  };
}

export async function parseAbacatePayWebhook(rawBody: string, ctx: WebhookContext): Promise<ParsedBillingEvent | null> {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new AppError({ code: "validation", userMessage: "Payload de webhook inválido." });
  }
  const env = obj(json);
  const eventName = str(env.event);
  if (!eventName) throw new AppError({ code: "validation", userMessage: "Payload de webhook inválido." });
  // `id` (log_...) e igual em todas as retentativas. A doc de `transparent.completed` nao mostra `id`: sem ele, hash do corpo cru (retentativas = mesmo corpo).
  const eventId = str(env.id) ?? `abacatepay:${eventName}:${createHash("sha256").update(rawBody).digest("hex").slice(0, 32)}`;
  const data = obj(env.data);
  const { now } = ctx;

  const subscription = obj(data.subscription);
  const subsId = str(subscription.id);
  const billId = str(obj(data.checkout).id);

  if (!HANDLED.has(eventName)) {
    console.warn(`[abacatepay-webhook] evento ignorado event=${eventName} eventId=${eventId} subs=${subsId ?? "-"} bill=${billId ?? "-"}${RECOGNIZED_IGNORED.has(eventName) ? "" : " (desconhecido)"}`);
    return null;
  }

  if (eventName === "transparent.completed") {
    const r = await resolveTransparentEvent(data);
    if (!r?.local) return orphan(eventName, { eventId, transparent: str(obj(data.transparent).id) });
    const t = obj(data.transparent);
    const paidAt = recentOrNow(date(t.updatedAt) ?? date(t.createdAt), now);
    const base = r.local.currentPeriodEnd && r.local.currentPeriodEnd.getTime() > paidAt.getTime() ? r.local.currentPeriodEnd : paidAt;
    return {
      eventId, type: "subscription.updated", orgId: r.orgId, planKey: r.local.plan.key, cadence: r.local.cadence, status: "active",
      currentPeriodEnd: addCycle(base, r.local.cadence), cancelAtPeriodEnd: false,
      // Id da cobranca PIX NAO e id de assinatura: preserva o que ja esta gravado (D-063-13).
      externalCustomerId: r.local.externalCustomerId, externalSubscriptionId: r.local.externalSubscriptionId,
      amountCents: cents(t.paidAmount) ?? cents(t.amount), paymentMethod: "pix", cardLast4: null, cardBrand: null,
      externalPaymentId: str(t.id), paidAt, provider: "abacatepay", receiptUrl: str(t.receiptUrl),
    };
  }

  const r = await resolveSubscriptionEvent(data, ctx);
  if (!r) return orphan(eventName, { eventId, subs: subsId, bill: billId });
  const { local } = r;

  // D-063-13: evento de assinatura VELHA (re-assinatura por novo checkout) nunca mexe na assinatura nova. `completed` com subs_ novo substitui o id.
  if (eventName !== "subscription.completed" && subsId && local?.externalSubscriptionId && local.externalSubscriptionId !== subsId) {
    console.warn(`[abacatepay-webhook] assinatura antiga ignorada event=${eventName} eventId=${eventId} subs=${subsId} atual=${local.externalSubscriptionId}`);
    return null;
  }

  const product = await planFromProduct(str(obj(Array.isArray(obj(data.checkout).items) ? (obj(data.checkout).items as unknown[])[0] : null).id), ctx.keyFingerprint);
  const planKey = product?.planKey ?? local?.plan.key ?? null;
  const cadence = product?.cadence ?? local?.cadence ?? null;
  if (!planKey || !cadence) return orphan(eventName, { eventId, subs: subsId, bill: billId, org: r.orgId });

  const customerId = str(obj(data.customer).id) ?? local?.externalCustomerId ?? null;
  const pay = paymentFields(data, "card");
  const paidAt = recentOrNow(date(obj(data.payment).paidAt) ?? date(obj(data.payment).updatedAt) ?? date(obj(data.payment).createdAt), now);
  const common = { orgId: r.orgId, planKey, cadence, externalCustomerId: customerId, ...pay, paidAt, provider: "abacatepay" as const };

  if (eventName === "subscription.completed") {
    return { ...common, eventId, type: "subscription.created", status: "active", currentPeriodEnd: addCycle(paidAt, cadence), cancelAtPeriodEnd: false, externalSubscriptionId: subsId };
  }

  if (eventName === "subscription.renewed") {
    const base = local?.currentPeriodEnd && local.currentPeriodEnd.getTime() > paidAt.getTime() ? local.currentPeriodEnd : paidAt;
    return { ...common, eventId, type: "subscription.updated", status: "active", currentPeriodEnd: addCycle(base, cadence), cancelAtPeriodEnd: false, externalSubscriptionId: subsId ?? local?.externalSubscriptionId ?? null };
  }

  if (eventName === "subscription.payment_failed") {
    console.warn(`[abacatepay-webhook] falha de cobranca eventId=${eventId} subs=${subsId ?? "-"} retryNumber=${String(data.retryNumber ?? "-")}`);
    return {
      eventId, type: "payment.failed", orgId: r.orgId, planKey, cadence, status: "past_due",
      currentPeriodEnd: local?.currentPeriodEnd ?? null, cancelAtPeriodEnd: local?.cancelAtPeriodEnd ?? false,
      externalCustomerId: customerId, externalSubscriptionId: subsId ?? local?.externalSubscriptionId ?? null,
      amountCents: cents(subscription.amount), paymentMethod: subscription.method === "PIX" ? "pix" : "card", cardLast4: null, cardBrand: null,
      // SPEC-066a: identidade da parcela que falhou (o provedor nao envia motivo/vencimento/link).
      provider: "abacatepay", installmentId: str(data.installmentId), installmentNumber: intOrNull(data.installmentNumber), retryNumber: intOrNull(data.retryNumber),
    };
  }

  // subscription.cancelled
  const dueToFailure = str(subscription.cancelledDueTo) === "max_payment_retries_exceeded";
  if (local?.status === "canceled") {
    console.warn(`[abacatepay-webhook] cancelamento ja refletido localmente eventId=${eventId} subs=${subsId ?? "-"}`);
    return null;
  }
  const scheduledStillValid = local?.cancelAtPeriodEnd === true && !!local.currentPeriodEnd && local.currentPeriodEnd.getTime() > now.getTime();
  if (scheduledStillValid && !dueToFailure && local) {
    // D-063-14/17: cancelamento AGENDADO pelo proprio usuario — o provedor cancela na hora, mas o acesso pago e nosso ate o fim do periodo; so confirmacao.
    return {
      eventId, type: "subscription.updated", orgId: r.orgId, planKey: local.plan.key, cadence: local.cadence, status: local.status,
      currentPeriodEnd: local.currentPeriodEnd, cancelAtPeriodEnd: true,
      externalCustomerId: local.externalCustomerId, externalSubscriptionId: local.externalSubscriptionId,
    };
  }
  return {
    eventId, type: "subscription.canceled", orgId: r.orgId, planKey, cadence, status: "canceled",
    currentPeriodEnd: local?.currentPeriodEnd ?? null, cancelAtPeriodEnd: false,
    externalCustomerId: customerId, externalSubscriptionId: subsId ?? local?.externalSubscriptionId ?? null, provider: "abacatepay",
  };
}
