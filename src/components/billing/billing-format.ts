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
