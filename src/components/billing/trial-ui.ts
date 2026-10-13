import type { OrgAccessState } from "@/lib/billing/access";
import type { ExtraLimitMetric, LimitMetric } from "@/lib/billing/limits";

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

/** SPEC-069d: metricas de uso do medidor = as 5 da 065 + as novas da 069 (agentes, IA, criativos, equipe...). */
export type UsageMetric = LimitMetric | ExtraLimitMetric;

export interface UsageItem {
  metric: UsageMetric;
  label: string;
  /** Complemento curto do periodo ("ativas", "durante o teste", "hoje"). */
  scope: string;
  used: number;
  /** `null` = ilimitado. */
  limit: number | null;
  /** `brl_cents`: `used`/`limit` em centavos (formatados como R$). */
  unit?: "brl_cents";
}

export const METRIC_LABELS: Record<UsageMetric, { label: string; scope: string }> = {
  campaigns: { label: "Campanhas ativas", scope: "ao mesmo tempo" },
  whatsapp: { label: "Números de WhatsApp", scope: "conectados" },
  email_accounts: { label: "Contas de e-mail", scope: "conectadas" },
  leads: { label: "Leads", scope: "no período do plano" },
  sends: { label: "Envios", scope: "hoje" },
  agents: { label: "Agentes de IA ativos", scope: "ao mesmo tempo" },
  ai_budget: { label: "Custo de IA", scope: "neste mês" },
  agent_messages: { label: "Mensagens de IA por agente", scope: "hoje" },
  lead_searches: { label: "Buscas de leads", scope: "hoje" },
  creatives: { label: "Criativos de vídeo", scope: "neste mês" },
  members: { label: "Membros da equipe", scope: "na organização" },
  sequence_steps: { label: "Passos por sequência", scope: "por sequência" },
};

/** SPEC-069d: limite 0 = o plano NAO inclui o recurso (nao e "limite atingido"). */
export function isNotIncluded(item: Pick<UsageItem, "limit">): boolean {
  return item.limit === 0;
}

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
export function usageText(item: Pick<UsageItem, "used" | "limit"> & { unit?: "brl_cents" }): string {
  const fmt = (n: number): string => (item.unit === "brl_cents" ? (n / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : n.toLocaleString("pt-BR"));
  if (item.limit === 0 && item.used === 0) return "Não incluído no seu plano";
  return item.limit === null ? `${fmt(item.used)} (sem limite)` : `${fmt(item.used)} de ${fmt(item.limit)}`;
}

/** Mensagem curta para o aviso "voce chegou no limite" ao lado de botoes desabilitados. */
export function limitReachedText(metric: UsageMetric, limit: number): string {
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
    case "agents":
      return `Você já usa ${n} de ${n} agente${limit === 1 ? "" : "s"} de IA ativo${limit === 1 ? "" : "s"} do seu plano.`;
    case "ai_budget":
      return "Você chegou no teto de custo de IA do seu plano neste mês.";
    case "agent_messages":
      return `Cada agente já propôs ${n} de ${n} mensage${limit === 1 ? "m" : "ns"} de hoje.`;
    case "lead_searches":
      return `Você já fez ${n} de ${n} busca${limit === 1 ? "" : "s"} de leads de hoje.`;
    case "creatives":
      return `Você já gerou ${n} de ${n} criativo${limit === 1 ? "" : "s"} deste mês.`;
    case "members":
      return `Sua equipe já tem ${n} de ${n} membro${limit === 1 ? "" : "s"} do seu plano.`;
    case "sequence_steps":
      return `Suas sequências já usam ${n} de ${n} passo${limit === 1 ? "" : "s"} do seu plano.`;
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
