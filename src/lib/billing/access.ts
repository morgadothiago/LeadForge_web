import type { OrgStatus, SubscriptionStatus } from "@prisma/client";
import { computeOrgStatus } from "./status-map";

/**
 * SPEC-065 (D-065-12) — ÚNICA fonte de "a organizacao pode usar o produto?". Funcao PURA (relogio injetado), derivada do estado
 * da `Subscription` e nao do tick: `syncOrgStatuses` so grava `Organization.status` para o scheduler parar; o bloqueio de UI/acoes
 * nao espera o tick. Reutiliza `computeOrgStatus` para o mapeamento ja existente (033/053/062) e acrescenta so a distincao
 * `trial_expirado` (BLOQUEIO TOTAL) x `soft_blocked` (leitura liberada, escrita barrada; 033/053 inalterado, Q-065-10).
 */
export type OrgAccessState =
  | "trial_ativo"
  | "trial_expirando"
  | "trial_expirado"
  | "pago"
  | "pago_em_atraso"
  | "soft_blocked"
  /** Org sem Subscription (admin/seed/cortesia antiga): ilimitada e sem bloqueio (D-065-25). */
  | "sem_assinatura";

export const TRIAL_EXPIRING_MS = 3 * 24 * 3600_000;

export interface AccessSubscription {
  status: SubscriptionStatus;
  pastDueSince: Date | null;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: Date | null;
  trialEndsAt: Date | null;
}

export interface AccessOrg {
  status: OrgStatus;
}

export function resolveOrgAccess(sub: AccessSubscription | null, org: AccessOrg, now: Date): OrgAccessState {
  if (!sub) return org.status === "active" ? "sem_assinatura" : "soft_blocked";
  if (sub.status === "trialing") {
    const left = sub.trialEndsAt ? sub.trialEndsAt.getTime() - now.getTime() : 0;
    if (left <= 0) return "trial_expirado"; // sem data = expirado (mesma regra de computeOrgStatus)
    if (org.status !== "active") return "soft_blocked"; // suspensao manual/cancelada do admin durante o trial
    return left <= TRIAL_EXPIRING_MS ? "trial_expirando" : "trial_ativo";
  }
  if (computeOrgStatus(sub, now) === "suspended" || org.status !== "active") return "soft_blocked";
  return sub.status === "past_due" ? "pago_em_atraso" : "pago";
}

/** Estados em que o acesso a organizacao e TOTALMENTE bloqueado (D-065-13). */
export function isFullyBlocked(state: OrgAccessState): boolean {
  return state === "trial_expirado";
}

export { trialDaysLeft } from "./trial-days";
