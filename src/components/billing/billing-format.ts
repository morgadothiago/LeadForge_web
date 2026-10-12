import type { BillingCadence, OrgStatus, SubscriptionStatus } from "@prisma/client";

/** SPEC-034 — formatação/rótulos PT-BR do domínio de billing. Espelha `formatBRLCents` de `agent-format.ts` (mesma fórmula, módulo próprio para não acoplar billing a agentes). */
export const formatBRLCents = (c: number): string => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const CADENCE_LABELS: Record<BillingCadence, string> = { monthly: "Mensal", yearly: "Anual" };

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: "Em teste (trial)",
  active: "Ativa",
  past_due: "Pagamento pendente",
  canceled: "Cancelada",
  incomplete: "Pagamento incompleto",
};

/** Tom do badge de status: bom (ativa/trial), alerta (pendente/incompleto) ou negativo (cancelada). */
export function subscriptionStatusTone(status: SubscriptionStatus): "ok" | "warn" | "bad" {
  if (status === "active" || status === "trialing") return "ok";
  if (status === "past_due" || status === "incomplete") return "warn";
  return "bad";
}

export const ORG_STATUS_LABELS: Record<OrgStatus, string> = {
  active: "Ativa",
  suspended: "Suspensa",
  cancelled: "Cancelada",
};

/** Preço a exibir no card conforme a cadência escolhida. `null` = "sob consulta" (plano sem checkout self-service, ex. Business). */
export function priceForCadence(plan: { priceMonthlyCents: number; priceYearlyCents: number | null }, cadence: BillingCadence): number | null {
  if (cadence === "monthly") return plan.priceMonthlyCents;
  return plan.priceYearlyCents;
}

/** Rótulo do limite de plano (D-33-2, formato placeholder de `Plan.limits`); `null` = ilimitado. */
export function limitLabel(value: number | null, unit: string): string {
  if (value === null) return `${unit} ilimitado(s)`;
  return `${value.toLocaleString("pt-BR")} ${unit}`;
}

/** SPEC-053b (D-053-1/3/4) — retenção dos dados após o cancelamento efetivado. */
export const RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;
export const addDays = (d: Date, days: number): Date => new Date(d.getTime() + days * DAY_MS);

export type CancelUiState = "none" | "scheduled" | "canceled";

/** Estado de cancelamento para a UI. `canceled` = efetivado (status canceled OU agendado com período vencido: reativar exige nova contratação, D-053-4). */
export function cancelUiState(sub: { status: SubscriptionStatus; cancelAtPeriodEnd: boolean; currentPeriodEnd: Date | null }, now: Date = new Date()): CancelUiState {
  if (sub.status === "canceled") return "canceled";
  if (sub.cancelAtPeriodEnd) return sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() > now.getTime() ? "scheduled" : "canceled";
  return "none";
}

/** Data de expurgo: efetivado = canceledAt + 90d; agendado = currentPeriodEnd + 90d; senão null. */
export function purgeDateFor(sub: { canceledAt: Date | null; currentPeriodEnd: Date | null }, state: CancelUiState): Date | null {
  if (state === "canceled") {
    const anchor = sub.canceledAt ?? sub.currentPeriodEnd;
    return anchor ? addDays(anchor, RETENTION_DAYS) : null;
  }
  if (state === "scheduled" && sub.currentPeriodEnd) return addDays(sub.currentPeriodEnd, RETENTION_DAYS);
  return null;
}

/**
 * SPEC-062b — texto da faixa global "assinatura pendente" (`SubscriptionPendingBanner`). `trialExpired` = ramo LEGADO (D-062-17):
 * org que estava em `trialing` e passou de `trialEndsAt` (nenhuma org nova entra em trial).
 */
export function pendingBannerMessage(status: OrgStatus, trialExpired: boolean): string {
  if (status === "cancelled") return "Sua assinatura foi cancelada. Alguns recursos ficam bloqueados até regularizar.";
  if (trialExpired) return "Seu período de teste terminou. Escolha um plano para continuar usando todos os recursos.";
  return "Sua assinatura está com o pagamento pendente. Alguns recursos ficam bloqueados até regularizar.";
}

export function pendingBannerCta(trialExpired: boolean): string {
  return trialExpired ? "Escolher um plano" : "Regularizar assinatura";
}
