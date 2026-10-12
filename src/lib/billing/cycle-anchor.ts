import type { BillingCadence } from "@prisma/client";
import { addCycle } from "./providers/abacatepay-webhook";

/**
 * SPEC-066a (Q-066-1, pos-QA A1) — vencimentos ANCORADOS no dia do 1o pagamento, sem deriva.
 * `addCycle` encadeado (31/01 -> 28/02 -> 28/03...) perde o dia; aqui o N-esimo vencimento e calculado SEMPRE a partir da ancora, com
 * clamp ao ultimo dia do mes (31/01 -> 28/02 -> 31/03; anual 29/02/2028 -> 28/02/2029 -> 29/02/2032). O dia/hora sao os do fuso
 * America/Sao_Paulo (UTC-3 fixo: o Brasil nao tem horario de verao desde 2019), entao pagamento 22h SP em 31/01 (01h UTC de 01/02) ancora no dia 31.
 */
const SP_OFFSET_MS = 3 * 3600_000;
const SNAP_TOLERANCE_MS = 7 * 24 * 3600_000;

function localParts(d: Date) {
  const l = new Date(d.getTime() - SP_OFFSET_MS);
  return { y: l.getUTCFullYear(), m: l.getUTCMonth(), day: l.getUTCDate(), h: l.getUTCHours(), mi: l.getUTCMinutes(), s: l.getUTCSeconds(), ms: l.getUTCMilliseconds() };
}

const stepMonths = (c: BillingCadence) => (c === "yearly" ? 12 : 1);

/** N-esimo vencimento (n >= 0) a partir da ancora. Funcao pura, sem acumular deriva. */
export function addCycleFromAnchor(anchor: Date, n: number, cadence: BillingCadence): Date {
  const p = localParts(anchor);
  const total = p.m + n * stepMonths(cadence);
  const y = p.y + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(p.day, lastDay), p.h, p.mi, p.s, p.ms) + SP_OFFSET_MS);
}

/** Indice N cujo vencimento ancorado e o mais proximo de `date` e esse vencimento; `null` se nenhum cai a <= 7 dias (data fora do ciclo: nao ajusta). */
function nearest(date: Date, anchor: Date, cadence: BillingCadence): { n: number; due: Date } | null {
  const a = localParts(anchor);
  const d = localParts(date);
  const base = Math.round(((d.y - a.y) * 12 + (d.m - a.m)) / stepMonths(cadence));
  let best: { n: number; due: Date } | null = null;
  for (const n of [base - 1, base, base + 1]) {
    if (n < 0) continue;
    const due = addCycleFromAnchor(anchor, n, cadence);
    if (!best || Math.abs(due.getTime() - date.getTime()) < Math.abs(best.due.getTime() - date.getTime())) best = { n, due };
  }
  return best && Math.abs(best.due.getTime() - date.getTime()) <= SNAP_TOLERANCE_MS ? best : null;
}

/** Corrige a deriva: devolve o vencimento ancorado correspondente a `date` (ou `date` se nao houver ancora/proximidade). */
export function snapToAnchor(date: Date, anchor: Date | null, cadence: BillingCadence): Date {
  if (!anchor) return date;
  return nearest(date, anchor, cadence)?.due ?? date;
}

/** Vencimento seguinte ao de `date` (um ciclo depois), ancorado; sem ancora cai no `addCycle` simples. */
export function nextDueFromAnchor(date: Date, anchor: Date | null, cadence: BillingCadence): Date {
  if (!anchor) return addCycle(date, cadence);
  const hit = nearest(date, anchor, cadence);
  return hit ? addCycleFromAnchor(anchor, hit.n + 1, cadence) : addCycle(date, cadence);
}

interface AnchorClient {
  billingCharge: {
    findFirst(args: { where: { orgId: string; status: "paid"; cadence: BillingCadence; paidAt: { not: null } }; orderBy: { paidAt: "asc" }; select: { paidAt: true } }): Promise<{ paidAt: Date | null } | null>;
  };
}

/** Ancora = `paidAt` da 1a cobranca `paid` da org na mesma cadencia (nao existe -> `null`; orgs anteriores a 066a ficam sem ajuste). */
export async function findAnchor(client: AnchorClient, orgId: string, cadence: BillingCadence): Promise<Date | null> {
  const row = await client.billingCharge.findFirst({ where: { orgId, status: "paid", cadence, paidAt: { not: null } }, orderBy: { paidAt: "asc" }, select: { paidAt: true } });
  return row?.paidAt ?? null;
}
