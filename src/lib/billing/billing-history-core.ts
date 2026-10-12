import type { BillingCadence, BillingChargeMethod, BillingChargeStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { PAST_DUE_GRACE_MS } from "@/lib/billing/status-map";
import { findAnchor, snapToAnchor } from "@/lib/billing/cycle-anchor";

/**
 * SPEC-066a — NUCLEO PURO do historico (sem sessao): recebe `orgId` e relogio injetados. NAO chamar com `orgId` vindo do cliente;
 * o ponto de entrada autenticado e `getBillingHistory` em `@/lib/queries/billing-history`. Historico de mensalidades da organizacao da SESSAO. Leitura para `owner` E `member` (Q-066-2: ambos veem valores;
 * as acoes de pagar sao so do owner e ficam para a 066b/066c). Nenhum `orgId` e aceito do cliente: `getBillingHistory` resolve a
 * org na sessao; `loadBillingHistory` (puro, `orgId` + relogio injetados) e o miolo testavel e NAO deve ser chamado com id vindo do cliente.
 * "Atrasada" (`overdue`) e "cancelada" para pendentes de org cancelada sao DERIVADAS aqui (D-066-6), nunca gravadas.
 * Sem backfill (D-066-10): quem ja pagava antes da migration comeca com historico vazio.
 */

export const BILLING_HISTORY_PAGE_SIZE = 12;

export type BillingHistoryFilter = "all" | "open" | "paid" | "problems";
export type BillingChargeViewStatus = BillingChargeStatus | "overdue";

export interface BillingChargeDto {
  id: string;
  status: BillingChargeViewStatus;
  method: BillingChargeMethod;
  planKey: string;
  cadence: BillingCadence;
  amountCents: number;
  currency: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  dueAt: Date | null;
  paidAt: Date | null;
  retryCount: number;
  cardBrand: string | null;
  cardLast4: string | null;
  receiptUrl: string | null;
}

export interface BillingHistorySummary {
  /** Soma das cobrancas `paid` (reembolsadas ficam de fora). Independe de filtro e de pagina. */
  totalPaidCents: number;
  /** Proxima mensalidade: a linha pendente real (`predicted:false`) ou a projecao na leitura (`predicted:true`, D-066-7); `null` se nao ha. */
  next: { amountCents: number; dueAt: Date; predicted: boolean; planKey: string; cadence: BillingCadence; method: BillingChargeMethod | null } | null;
  /** Cobrancas em aberto vencidas: `pending` com `dueAt < agora` + `failed`. `since`: `pastDueSince` da assinatura (se `past_due`) ou o vencimento mais antigo. */
  overdue: { count: number; totalCents: number; since: Date | null; graceEndsAt: Date | null } | null;
}

export interface BillingHistoryPage {
  items: BillingChargeDto[];
  nextCursor: string | null;
  summary: BillingHistorySummary;
  /** Estado vazio (nenhuma cobranca gravada na org, independente do filtro). */
  hasAnyCharge: boolean;
  /** UX apenas para a 066c (acoes de pagar so do owner; a barreira real e `requireOwner` na action). */
  isOwner: boolean;
}

export interface LoadBillingHistoryInput {
  orgId: string;
  cursor?: string | null;
  filter?: BillingHistoryFilter;
  now: Date;
  isOwner?: boolean;
}

const FILTERS: ReadonlySet<string> = new Set(["all", "open", "paid", "problems"]);

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const bad = () => new AppError({ code: "validation", userMessage: "Cursor inválido." });
  let raw: string;
  try {
    raw = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw bad();
  }
  const sep = raw.indexOf("|");
  if (sep < 1) throw bad();
  const createdAt = new Date(raw.slice(0, sep));
  const id = raw.slice(sep + 1);
  if (Number.isNaN(createdAt.getTime()) || !id || id.length > 64) throw bad();
  return { createdAt, id };
}

function whereForFilter(filter: BillingHistoryFilter, now: Date, orgCanceled: boolean): Prisma.BillingChargeWhereInput {
  switch (filter) {
    case "paid":
      return { status: "paid" };
    case "open":
      // Org cancelada: pendentes sao exibidas como `canceled`, nao "em aberto".
      return orgCanceled ? { status: "failed" } : { status: { in: ["pending", "failed"] } };
    case "problems":
      return orgCanceled
        ? { status: { in: ["failed", "refunded", "canceled", "pending"] } }
        : { OR: [{ status: { in: ["failed", "refunded", "canceled"] } }, { status: "pending", dueAt: { lt: now } }] };
    default:
      return {};
  }
}

function toDto(c: { id: string; status: BillingChargeStatus; method: BillingChargeMethod; planKey: string; cadence: BillingCadence; amountCents: number; currency: string; periodStart: Date | null; periodEnd: Date | null; dueAt: Date | null; paidAt: Date | null; retryCount: number; cardBrand: string | null; cardLast4: string | null; receiptUrl: string | null }, now: Date, orgCanceled: boolean): BillingChargeDto {
  let status: BillingChargeViewStatus = c.status;
  if (c.status === "pending") {
    if (orgCanceled) status = "canceled";
    else if (c.dueAt && c.dueAt.getTime() < now.getTime()) status = "overdue";
  }
  return {
    id: c.id, status, method: c.method, planKey: c.planKey, cadence: c.cadence, amountCents: c.amountCents, currency: c.currency,
    periodStart: c.periodStart, periodEnd: c.periodEnd, dueAt: c.dueAt, paidAt: c.paidAt, retryCount: c.retryCount,
    cardBrand: c.cardBrand, cardLast4: c.cardLast4, receiptUrl: c.receiptUrl,
  };
}

export async function loadBillingHistory(input: LoadBillingHistoryInput): Promise<BillingHistoryPage> {
  const { orgId, now } = input;
  const filter: BillingHistoryFilter = input.filter && FILTERS.has(input.filter) ? input.filter : "all";
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;

  const sub = await prisma.subscription.findUnique({
    where: { orgId },
    select: { status: true, cadence: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, pastDueSince: true, plan: { select: { key: true, priceMonthlyCents: true, priceYearlyCents: true } } },
  });
  const orgCanceled = sub?.status === "canceled";

  const where: Prisma.BillingChargeWhereInput = {
    AND: [
      { orgId },
      whereForFilter(filter, now, orgCanceled),
      ...(cursor ? [{ OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }] : []),
    ],
  };

  const [rows, paidAgg, anyCount, openRows] = await Promise.all([
    prisma.billingCharge.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: BILLING_HISTORY_PAGE_SIZE + 1 }),
    prisma.billingCharge.aggregate({ where: { orgId, status: "paid" }, _sum: { amountCents: true } }),
    prisma.billingCharge.count({ where: { orgId } }),
    orgCanceled ? Promise.resolve([]) : prisma.billingCharge.findMany({ where: { orgId, status: { in: ["pending", "failed"] } }, select: { status: true, amountCents: true, dueAt: true, planKey: true, cadence: true, method: true }, orderBy: [{ dueAt: "asc" }, { id: "asc" }] }),
  ]);

  const hasMore = rows.length > BILLING_HISTORY_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, BILLING_HISTORY_PAGE_SIZE) : rows;
  const last = page[page.length - 1];

  // Resumo: em atraso (derivado) e proxima mensalidade.
  const overdueRows = openRows.filter((r) => r.status === "failed" || (r.dueAt && r.dueAt.getTime() < now.getTime()));
  let overdue: BillingHistorySummary["overdue"] = null;
  if (overdueRows.length > 0) {
    const oldest = overdueRows.map((r) => r.dueAt).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const since = sub?.status === "past_due" && sub.pastDueSince ? sub.pastDueSince : oldest;
    overdue = {
      count: overdueRows.length,
      totalCents: overdueRows.reduce((sum, r) => sum + r.amountCents, 0),
      since,
      graceEndsAt: sub?.status === "past_due" && sub.pastDueSince ? new Date(sub.pastDueSince.getTime() + PAST_DUE_GRACE_MS) : null,
    };
  }

  let next: BillingHistorySummary["next"] = null;
  const realNext = openRows.find((r) => r.status === "pending" && r.dueAt);
  if (realNext?.dueAt) {
    next = { amountCents: realNext.amountCents, dueAt: realNext.dueAt, predicted: false, planKey: realNext.planKey, cadence: realNext.cadence, method: realNext.method };
  } else if (sub && sub.status === "active" && !sub.cancelAtPeriodEnd && sub.currentPeriodEnd && openRows.length === 0) {
    // Projecao na leitura (D-066-7): so a proxima, preco/cadencia vigentes, sem gravar; sem preco (ex.: Business/cortesia) nao projeta.
    const price = sub.cadence === "yearly" ? sub.plan.priceYearlyCents : sub.plan.priceMonthlyCents;
    const anchor = await findAnchor(prisma, orgId, sub.cadence);
    if (price != null && price > 0) next = { amountCents: price, dueAt: snapToAnchor(sub.currentPeriodEnd, anchor, sub.cadence), predicted: true, planKey: sub.plan.key, cadence: sub.cadence, method: null };
  }

  return {
    items: page.map((c) => toDto(c, now, orgCanceled)),
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    summary: { totalPaidCents: paidAgg._sum.amountCents ?? 0, next, overdue },
    hasAnyCharge: anyCount > 0,
    isOwner: input.isOwner ?? false,
  };
}

