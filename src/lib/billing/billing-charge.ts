import type { BillingChargeMethod, BillingChargeStatus, Prisma } from "@prisma/client";
import type { ParsedBillingEvent } from "./provider";
import { findAnchor, nextDueFromAnchor, snapToAnchor } from "./cycle-anchor";

/**
 * SPEC-066a — alimentacao do historico de cobrancas (`BillingCharge`) a partir de um `ParsedBillingEvent`, DENTRO da transacao de
 * `processBillingEvent` (D-066-3). Regras: identidade por `(provider, externalId)` (D-066-2); monotonia de status (D-066-4: `paid`,
 * `refunded` e `canceled` nunca regridem por evento atrasado/reenviado); falha de cartao atualiza a MESMA linha da parcela (D-066-5);
 * nunca guarda numero de cartao, taxId, e-mail do pagador nem payload bruto (D-066-12). "overdue" NAO e gravado (D-066-6).
 *
 * Usa `createMany({ skipDuplicates })` (ON CONFLICT DO NOTHING) para criar: um P2002 aqui abortaria a transacao inteira e
 * `processBillingEvent` o traduziria em "duplicate", descartando o evento de pagamento.
 */

type Tx = Prisma.TransactionClient;

export interface ChargeEventContext {
  now: Date;
  /** `Subscription.currentPeriodEnd` ANTES do evento (ancora do vencimento, Q-066-1). */
  priorPeriodEnd: Date | null;
  /** Preco do plano x cadencia (so fallback quando o provedor nao informa o valor, ex.: mock; D-052-3). */
  planAmountCents: number | null;
}

/** So `https` em abacatepay.com (ou subdominio); qualquer outra coisa vira null (D-066-12). */
export function safeReceiptUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return host === "abacatepay.com" || host.endsWith(".abacatepay.com") ? u.toString() : null;
  } catch {
    return null;
  }
}

/** PIX: `pix_char_x` e `char_x` sao a mesma cobranca (a criacao devolve com prefixo, o webhook sem). */
export function normalizeChargeId(id: string | null | undefined, method: BillingChargeMethod): string | null {
  if (!id) return null;
  return method === "pix" ? id.replace(/^pix_/, "") : id;
}

function providerOf(event: ParsedBillingEvent): string {
  if (event.provider) return event.provider;
  const env = process.env.PAYMENT_PROVIDER;
  return env === "stripe" || env === "abacatepay" ? env : "mock";
}

/** D-066-4: `pending` -> `failed|paid|canceled|refunded`; `failed` -> `failed|paid|canceled|refunded`; `paid` -> `refunded`; `refunded`/`canceled` terminais. */
export function canTransition(from: BillingChargeStatus, to: BillingChargeStatus): boolean {
  if (from === to) return from === "failed"; // so a falha se reaplica (retryCount); o resto e no-op
  if (from === "refunded" || from === "canceled") return false;
  if (from === "paid") return to === "refunded";
  return true;
}

export async function recordChargeFromEvent(tx: Tx, event: ParsedBillingEvent, ctx: ChargeEventContext): Promise<void> {
  const { orgId } = event;
  const provider = providerOf(event);
  const method: BillingChargeMethod = event.paymentMethod === "pix" ? "pix" : "card";

  // Cancelamento: so as cobrancas ainda PENDENTES (nunca paid/failed/refunded) viram `canceled`.
  if (event.status === "canceled") {
    await tx.billingCharge.updateMany({ where: { orgId, status: "pending" }, data: { status: "canceled" } });
    return;
  }

  if (event.type === "payment.failed" && event.status === "past_due") {
    await recordFailure(tx, event, ctx, provider, method);
    return;
  }

  if (event.status === "active" && event.externalPaymentId && event.type !== "subscription.canceled") {
    await recordPayment(tx, event, ctx, provider, method);
  }
}

async function recordFailure(tx: Tx, event: ParsedBillingEvent, ctx: ChargeEventContext, provider: string, method: BillingChargeMethod): Promise<void> {
  const externalId = normalizeChargeId(event.installmentId, method);
  if (!externalId) {
    console.warn(`[billing-charge] falha sem id de parcela utilizavel; cobranca nao gravada org=${event.orgId} eventId=${event.eventId}`);
    return;
  }
  const existing = await tx.billingCharge.findUnique({ where: { provider_externalId: { provider, externalId } } });
  if (existing) {
    if (existing.orgId !== event.orgId) return ignoreForeign(event, "falha");
    if (!canTransition(existing.status, "failed")) return; // paid/refunded/canceled nao regridem
    await tx.billingCharge.update({
      where: { id: existing.id },
      data: { status: "failed", retryCount: Math.max(existing.retryCount, event.retryNumber ?? existing.retryCount) },
    });
    return;
  }
  // Falha de OUTRA parcela depois de um pagamento (id diferente, sem como correlacionar: o provedor nao envia a competencia) fica como historico
  // de tentativa (D-066-2/D-066-5, caso ambiguo). A mesma parcela (mesmo `installmentId`) nunca regride (acima).
  const amountCents = event.amountCents ?? ctx.planAmountCents;
  if (amountCents == null) {
    console.warn(`[billing-charge] falha sem valor; cobranca nao gravada org=${event.orgId} eventId=${event.eventId}`);
    return;
  }
  // Vencimento = fim do periodo anterior (ancora, Q-066-1); sem ele, a data da 1a falha.
  // Pos-QA A1: ancorado no dia do 1o pagamento (sem a deriva do `addCycle` encadeado).
  const anchor = await findAnchor(tx, event.orgId, event.cadence);
  const dueAt = event.currentPeriodEnd ? snapToAnchor(event.currentPeriodEnd, anchor, event.cadence) : ctx.now;
  await tx.billingCharge.createMany({
    skipDuplicates: true,
    data: [
      {
        orgId: event.orgId,
        subscriptionId: method === "card" ? event.externalSubscriptionId : null,
        provider,
        externalId,
        amountCents,
        status: "failed",
        method,
        planKey: event.planKey,
        cadence: event.cadence,
        periodStart: dueAt,
        periodEnd: nextDueFromAnchor(dueAt, anchor, event.cadence),
        dueAt,
        retryCount: event.retryNumber ?? 0,
      },
    ],
  });
}

async function recordPayment(tx: Tx, event: ParsedBillingEvent, ctx: ChargeEventContext, provider: string, method: BillingChargeMethod): Promise<void> {
  const externalId = normalizeChargeId(event.externalPaymentId, method);
  if (!externalId) return;
  const amountCents = event.amountCents ?? ctx.planAmountCents;
  if (amountCents == null) {
    console.warn(`[billing-charge] pagamento sem valor; cobranca nao gravada org=${event.orgId} eventId=${event.eventId}`);
    return;
  }
  const paidAt = event.paidAt ?? ctx.now;
  const anchor = await findAnchor(tx, event.orgId, event.cadence);
  const priorEnd = ctx.priorPeriodEnd ? snapToAnchor(ctx.priorPeriodEnd, anchor, event.cadence) : null;
  const newEnd = event.currentPeriodEnd ? snapToAnchor(event.currentPeriodEnd, anchor, event.cadence) : null;
  const cardFields = method === "card" ? { cardBrand: event.cardBrand ?? null, cardLast4: event.cardLast4 && /^\d{4}$/.test(event.cardLast4) ? event.cardLast4 : null } : { cardBrand: null, cardLast4: null };
  const promote = {
    status: "paid" as const,
    paidAt,
    amountCents,
    periodEnd: newEnd,
    receiptUrl: safeReceiptUrl(event.receiptUrl),
    ...cardFields,
  };

  // 1) A propria cobranca (PIX pendente criado pelo job; ou reenvio do mesmo pagamento).
  const byId = await tx.billingCharge.findUnique({ where: { provider_externalId: { provider, externalId } } });
  if (byId) {
    if (byId.orgId !== event.orgId) return ignoreForeign(event, "pagamento"); // pos-QA B4: id de OUTRA org nunca e tocado
    if (byId.status === "pending" || byId.status === "failed") await tx.billingCharge.update({ where: { id: byId.id }, data: promote });
    return; // paid (reenvio), refunded, canceled: nada a fazer (monotonia)
  }
  // 2) Cartao: pagamento do MESMO ciclo de uma falha aberta (o `renewed` nao traz `installmentId`; correlacao pelo fim do periodo anterior).
  if (method === "card" && priorEnd) {
    const open = await tx.billingCharge.findFirst({
      where: { orgId: event.orgId, method: "card", status: { in: ["failed", "pending"] }, periodStart: priorEnd },
      orderBy: { createdAt: "asc" },
    });
    if (open) {
      await tx.billingCharge.update({ where: { id: open.id }, data: promote });
      return;
    }
  }
  // 3) Nova linha paga. Vencimento: na 1a cobranca = a data do pagamento (ancora, Q-066-1); depois, o fim do periodo anterior.
  const hadPaid = await tx.billingCharge.count({ where: { orgId: event.orgId, status: "paid" } });
  // Pos-QA B2: o mesmo pagamento reenviado com outro eventId, depois de convertido de uma falha (externalId da parcela), nao vira 2a linha paga.
  const samePayment = await tx.billingCharge.findFirst({ where: { orgId: event.orgId, method, status: "paid", paidAt, amountCents }, select: { id: true } });
  if (samePayment) return;
  const renewal = event.type !== "subscription.created" && hadPaid > 0 && priorEnd && newEnd && priorEnd < newEnd;
  const periodStart = renewal ? priorEnd! : paidAt;
  await tx.billingCharge.createMany({
    skipDuplicates: true,
    data: [
      {
        orgId: event.orgId,
        subscriptionId: method === "card" ? event.externalSubscriptionId : null,
        provider,
        externalId,
        method,
        planKey: event.planKey,
        cadence: event.cadence,
        periodStart,
        dueAt: periodStart,
        ...promote,
      },
    ],
  });
}

/** Pos-QA B4: `(provider, externalId)` ja pertence a OUTRA org (colisao/dado suspeito): ignora, sem tocar na linha alheia. Log so com ids internos. */
function ignoreForeign(event: ParsedBillingEvent, kind: string): void {
  console.error(`[billing-charge] ${kind} com id de provedor ja usado por OUTRA organizacao; ignorado org=${event.orgId} eventId=${event.eventId}`);
}
