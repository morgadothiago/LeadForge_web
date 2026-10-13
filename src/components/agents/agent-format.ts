import type { FeatureKey } from "@/lib/billing/plan-catalog";
import { lockedFeatureText } from "@/lib/billing/plan-ui";
import type { TenantEntitlementsView } from "@/lib/queries/entitlements";

export const ROLE_LABELS = { sdr: "SDR (1º toque)", followup: "Follow-up", closer: "Closer" } as const;
export const AUTONOMY_LABELS = { draft: "Rascunho (aprovo tudo)", sampled: "Amostragem", auto: "Automático" } as const;
export const RUN_STATUS_LABELS: Record<string, string> = { queued: "Na fila", done: "Concluída", blocked: "Bloqueada", error: "Erro", skipped: "Ignorada" };

export type UsageLevel = "ok" | "warn" | "stop" | "none";

/** Alerta em 80%, pausa em 100% (espelha budgetState do backend; só apresentação). */
export function usageLevel(spentCents: number, budgetCents: number | null): UsageLevel {
  if (!budgetCents || budgetCents <= 0) return "none";
  const pct = (spentCents / budgetCents) * 100;
  return pct >= 100 ? "stop" : pct >= 80 ? "warn" : "ok";
}
export function usagePercent(spentCents: number, budgetCents: number | null): number {
  if (!budgetCents || budgetCents <= 0) return 0;
  return Math.min(100, Math.round((spentCents / budgetCents) * 100));
}
export const formatBRLCents = (c: number): string => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
/** Custo de execução vem em micro-USD. */
export const formatMicroUsd = (m: number): string => `US$ ${(m / 1_000_000).toFixed(4)}`;
export const parseLines = (s: string): string[] => s.split("\n").map((x) => x.trim()).filter(Boolean);
export const parseBudgetToCents = (s: string): number | null => {
  const n = Number(s.replace(",", "."));
  return s.trim() && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};

export type BudgetInput = { ok: true; cents: number | null } | { ok: false; error: string };
/** Valida o campo de teto (R$). Texto inválido = erro (nunca apaga o teto); vazio só limpa com `clear` explícito. */
export function resolveBudgetInput(text: string, clear = false): BudgetInput {
  if (!text.trim()) return clear ? { ok: true, cents: null } : { ok: false, error: "Informe um valor em reais maior que zero." };
  if (clear) return { ok: false, error: "Desmarque \"Remover teto\" para informar um valor." };
  const c = parseBudgetToCents(text);
  return c === null ? { ok: false, error: "Valor inválido. Use apenas números, ex.: 50 ou 50,50." } : { ok: true, cents: c };
}
/** Agente novo pode ficar sem teto (vazio = sem teto); editar segue resolveBudgetInput. */
export const budgetToInput = (cents: number | null): string => (cents ? String(cents / 100) : "");

export const toggleId = (s: Set<string>, id: string): Set<string> => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; };
export const isEdited = (body: string, original: string): boolean => body.trim() !== original.trim();
export const canApprove = (body: string, pending: boolean, locked = false): boolean => !pending && !locked && body.trim().length > 0;
export const canReject = (reason: string, pending: boolean, locked = false): boolean => !pending && !locked && reason.trim().length > 0;
export const canBulk = (selected: number, pending: boolean): boolean => !pending && selected > 0;
export const bulkSummary = (r: { sent: number; blocked: number; skipped?: number; unverified?: boolean }): string =>
  `${r.sent} enviado(s), ${r.blocked} bloqueado(s) pela política de envio${r.skipped ? `, ${r.skipped} já tratado(s)` : ""}.${r.unverified ? " Confirme seu e-mail para poder enviar mensagens (veja o aviso no topo da tela)." : ""}`;
export const needsAutoConfirm = (role: string, autonomy: string): boolean => role === "closer" && autonomy !== "draft";
export const canConfirmAuto = (c1: boolean, c2: boolean, disclosureEnabled: boolean, pending: boolean): boolean => !pending && c1 && c2 && disclosureEnabled;
/** Desligar o aviso de IA num Closer autônomo faz o backend voltar a autonomia para rascunho. */
export const disclosureOffDowngrades = (role: string, autonomy: string, disclosure: boolean): boolean => role === "closer" && autonomy !== "draft" && !disclosure;
export const guardrailsLabel = (g: unknown): string => (Array.isArray(g) && g.length ? g.join(", ") : "");

// ---------------------------------------------------------------------------------------------------------------------------------
// SPEC-069d — o que o PLANO (+ override do admin) libera em agentes. So UX: a barreira real e o servidor (`assertFeature`).
// ---------------------------------------------------------------------------------------------------------------------------------
type RoleKey = keyof typeof ROLE_LABELS;
type AutonomyKey = keyof typeof AUTONOMY_LABELS;
export const ROLE_FEATURE_KEY: Record<RoleKey, FeatureKey> = { sdr: "agents.role.sdr", followup: "agents.role.followup", closer: "agents.role.closer" };
export const AUTONOMY_FEATURE_KEY: Record<AutonomyKey, FeatureKey> = { draft: "agents.autonomy.draft", sampled: "agents.autonomy.sample", auto: "agents.autonomy.auto" };

export interface AgentPlanView {
  roles: Record<RoleKey, boolean>;
  autonomy: Record<AutonomyKey, boolean>;
  /** `null` = sem teto; 0 = o plano nao inclui agentes. */
  maxActiveAgents: number | null;
  activeCount: number;
  /** IA nao confiavel agora (pagamento em atraso/assinatura inativa): nada de IA ate regularizar. */
  costlyBlocked: boolean;
  lockReason: "plan" | "past_due" | "blocked";
}

export function toAgentPlanView(ent: Pick<TenantEntitlementsView, "features" | "limits" | "paused" | "costlyBlocked">, activeCount: number): AgentPlanView {
  const f = ent.features;
  return {
    roles: { sdr: f["agents.role.sdr"] === true, followup: f["agents.role.followup"] === true, closer: f["agents.role.closer"] === true },
    autonomy: { draft: f["agents.autonomy.draft"] === true, sampled: f["agents.autonomy.sample"] === true, auto: f["agents.autonomy.auto"] === true },
    maxActiveAgents: ent.limits.maxActiveAgents,
    activeCount,
    costlyBlocked: ent.costlyBlocked,
    lockReason: ent.paused ? "past_due" : ent.costlyBlocked ? "blocked" : "plan",
  };
}

export const anyRoleAllowed = (p: AgentPlanView): boolean => Object.values(p.roles).some(Boolean);

/** "Disponível no plano Pro" para um papel de agente. */
export const roleLockText = (role: RoleKey): string => lockedFeatureText(ROLE_FEATURE_KEY[role]).text;
export const autonomyLockText = (a: AutonomyKey): string => lockedFeatureText(AUTONOMY_FEATURE_KEY[a]).text;

export type ActivateBlock = { kind: "role" | "autonomy" | "limit" | "billing" | "budget"; text: string } | null;

/**
 * Por que o botao "Ativar" de um agente esta bloqueado (ou `null` se pode tentar). Ordem: pagamento/assinatura, papel, modo de autonomia, limite de
 * agentes ativos e teto de custo do agente (definido pelo admin). Agente ja ativo nunca e bloqueado para DESLIGAR.
 */
export function activateBlock(plan: AgentPlanView, a: { role: RoleKey; autonomy: AutonomyKey; active: boolean; monthlyBudgetCents: number | null }): ActivateBlock {
  if (a.active) return null;
  if (plan.costlyBlocked) {
    return { kind: "billing", text: plan.lockReason === "past_due" ? "IA pausada por pagamento em atraso. Regularize a assinatura para ativar agentes." : "Assinatura inativa: regularize para ativar agentes." };
  }
  if (!plan.roles[a.role]) return { kind: "role", text: `${ROLE_LABELS[a.role]}: ${roleLockText(a.role).replace(/^D/, "d")}.` };
  if (!plan.autonomy[a.autonomy]) return { kind: "autonomy", text: `Modo ${AUTONOMY_LABELS[a.autonomy]}: ${autonomyLockText(a.autonomy).replace(/^D/, "d")}. Volte o agente para rascunho para ativar.` };
  if (plan.maxActiveAgents !== null && plan.activeCount >= plan.maxActiveAgents) {
    return { kind: "limit", text: plan.maxActiveAgents === 0 ? "Seu plano não inclui agentes de IA ativos." : `Seu plano permite ${plan.maxActiveAgents} agente${plan.maxActiveAgents === 1 ? "" : "s"} ativo${plan.maxActiveAgents === 1 ? "" : "s"} ao mesmo tempo. Desligue um ou faça upgrade.` };
  }
  if (!a.monthlyBudgetCents) return { kind: "budget", text: "Aguardando o teto de custo deste agente, definido pela plataforma." };
  return null;
}
