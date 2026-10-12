import type { OrgAccessState } from "@/lib/billing/access";
import type { LimitMetric } from "@/lib/billing/limits";

/**
 * SPEC-065b (D-065-24) — helpers PUROS (sem React) da UI do teste gratis: chip/banner de dias, rotulos e estados do medidor de uso.
 * Os dias vem de `trialDaysLeft` (backend, 065a); aqui so texto e regras de exibicao.
 */
export const UPGRADE_HREF = "/configuracoes/assinatura";

export function daysWord(days: number): string {
  return `${days} ${days === 1 ? "dia" : "dias"}`;
}

/** Chip do Header: "Teste grátis: 12 dias". */
export function trialChipText(days: number): string {
  return `Teste grátis: ${daysWord(days)}`;
}

/** Banner dos ultimos 3 dias (`trial_expirando`). */
export function trialBannerText(days: number): string {
  if (days <= 1) return "Seu teste grátis termina hoje ou amanhã. Faça o upgrade para não perder o acesso.";
  return `Faltam ${daysWord(days)} do seu teste grátis. Faça o upgrade para continuar usando depois.`;
}

/** Os estados em que o chip aparece. */
export function showsTrialChip(access: OrgAccessState | null | undefined): boolean {
  return access === "trial_ativo" || access === "trial_expirando";
}

export interface UsageItem {
  metric: LimitMetric;
  label: string;
  /** Complemento curto do periodo ("ativas", "durante o teste", "hoje"). */
  scope: string;
  used: number;
  /** `null` = ilimitado. */
  limit: number | null;
}

export const METRIC_LABELS: Record<LimitMetric, { label: string; scope: string }> = {
  campaigns: { label: "Campanhas ativas", scope: "ao mesmo tempo" },
  whatsapp: { label: "Números de WhatsApp", scope: "conectados" },
  email_accounts: { label: "Contas de e-mail", scope: "conectadas" },
  leads: { label: "Leads", scope: "no período do plano" },
  sends: { label: "Envios", scope: "hoje" },
};

export function isAtLimit(item: Pick<UsageItem, "used" | "limit">): boolean {
  return item.limit !== null && item.used >= item.limit;
}

/** Fração 0..1 para a barra (limite 0 = cheio). Ilimitado = 0. */
export function usageRatio(item: Pick<UsageItem, "used" | "limit">): number {
  if (item.limit === null) return 0;
  if (item.limit <= 0) return 1;
  return Math.min(1, item.used / item.limit);
}

export type UsageTone = "ok" | "warn" | "full";

export function usageTone(item: Pick<UsageItem, "used" | "limit">): UsageTone {
  if (isAtLimit(item)) return "full";
  return usageRatio(item) >= 0.8 ? "warn" : "ok";
}

/** "1 de 1" / "12 de 50" / "12 (sem limite)". */
export function usageText(item: Pick<UsageItem, "used" | "limit">): string {
  const used = item.used.toLocaleString("pt-BR");
  return item.limit === null ? `${used} (sem limite)` : `${used} de ${item.limit.toLocaleString("pt-BR")}`;
}

/** Mensagem curta para o aviso "voce chegou no limite" ao lado de botoes desabilitados. */
export function limitReachedText(metric: LimitMetric, limit: number): string {
  const n = limit.toLocaleString("pt-BR");
  switch (metric) {
    case "campaigns":
      return `Você já usa ${n} de ${n} campanha${limit === 1 ? "" : "s"} ativa${limit === 1 ? "" : "s"} do seu plano.`;
    case "whatsapp":
      return `Você já conectou ${n} de ${n} número${limit === 1 ? "" : "s"} de WhatsApp do seu plano.`;
    case "email_accounts":
      return `Você já adicionou ${n} de ${n} conta${limit === 1 ? "" : "s"} de e-mail do seu plano.`;
    case "leads":
      return `Você já trouxe ${n} de ${n} lead${limit === 1 ? "" : "s"} do seu plano.`;
    case "sends":
      return `Você já fez ${n} de ${n} envio${limit === 1 ? "" : "s"} de hoje.`;
  }
}

export type UpgradeReturnView = "idle" | "confirming" | "paid" | "timeout";

/**
 * Retorno do checkout de upgrade (D-065-9.3/15). `?checkout=success` so INICIA a espera; o pago vem do servidor (`paid`). Sem
 * `success` na URL nada e exibido (`idle`), inclusive `cancel` (tratado por toast).
 */
export function resolveUpgradeReturn(checkout: string | null, opts: { paid: boolean; timedOut: boolean }): UpgradeReturnView {
  if (checkout !== "success") return "idle";
  if (opts.paid) return "paid";
  return opts.timedOut ? "timeout" : "confirming";
}
