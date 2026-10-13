import { prisma } from "@/lib/prisma";
import { requireProviderOrg } from "@/lib/auth/require-admin";
import { getEntitlements, isCostlyBlocked, type Entitlements } from "@/lib/billing/entitlements";
import { PLAN_DISPLAY_NAMES, type PlanKey } from "@/lib/billing/plan-catalog";
import { monthlyOrgSpend } from "@/lib/agents/plan-gate";
import { budgetState, monthStart, type BudgetState } from "@/lib/agents/budget";
import { MICROS_PER_CENT } from "@/lib/agents/types";
import { METRIC_LABELS, type UsageItem } from "@/components/billing/trial-ui";

/**
 * SPEC-069d — leitura SOMENTE LEITURA do que o plano (+ override do admin) libera para a org da sessao, para a UI do tenant (bloqueios, upgrade,
 * medidores). Serializavel (sem `Date`). Nunca traz segredo nem politica interna do admin alem do que o plano efetivo permite. A barreira real e o
 * servidor (`assertFeature`/`assertWithinEntitlementLimit`); isto so evita mostrar um botao que o servidor vai recusar.
 */
export interface TenantEntitlementsView {
  planKey: string | null;
  planName: string | null;
  source: Entitlements["source"];
  /** `past_due`: IA/envio automatico pausados ate regularizar. */
  paused: boolean;
  /** IA/envio nao confiaveis agora (org bloqueada, plano ilegivel, erro de leitura ou `past_due`). */
  costlyBlocked: boolean;
  overrideActive: boolean;
  overrideExpiresAt: string | null;
  features: Entitlements["features"];
  limits: Entitlements["limits"];
  isOwner: boolean;
}

export function toTenantView(ent: Entitlements, isOwner: boolean): TenantEntitlementsView {
  return {
    planKey: ent.planKey,
    planName: ent.planKey ? (PLAN_DISPLAY_NAMES[ent.planKey as PlanKey] ?? ent.planKey) : null,
    source: ent.source,
    paused: ent.paused,
    costlyBlocked: isCostlyBlocked(ent),
    overrideActive: ent.overrideActive,
    overrideExpiresAt: ent.overrideExpiresAt?.toISOString() ?? null,
    features: ent.features,
    limits: ent.limits,
    isOwner,
  };
}

export async function getTenantEntitlements(now: Date = new Date()): Promise<TenantEntitlementsView> {
  const { user, orgId } = await requireProviderOrg();
  const [ent, membership] = await Promise.all([
    getEntitlements(prisma, orgId, now),
    prisma.membership.findUnique({ where: { userId_orgId: { userId: user.id, orgId } }, select: { orgRole: true } }),
  ]);
  return toTenantView(ent, membership?.orgRole === "owner");
}

export interface AiBudgetView {
  spentCents: number;
  /** Teto do PLANO (centavos); `null` = sem teto; `0` = o plano nao inclui IA. */
  capCents: number | null;
  state: BudgetState | "not_included";
  /** 0..1 (so quando ha teto > 0). */
  ratio: number;
}

/** Aviso do teto de custo de IA do plano: 80% = `alert`, 100% = `exhausted` (o agente pausa, D-069 secao B). Gasto = soma da ORG no mes (agentes + simulacoes). */
export function buildAiBudget(spentMicros: number, capCents: number | null): AiBudgetView {
  const spentCents = Math.round(spentMicros / MICROS_PER_CENT);
  if (capCents === null) return { spentCents, capCents, state: "no_budget", ratio: 0 };
  if (capCents <= 0) return { spentCents, capCents, state: "not_included", ratio: 0 };
  return { spentCents, capCents, state: budgetState(spentMicros, capCents), ratio: Math.min(1, spentMicros / (capCents * MICROS_PER_CENT)) };
}

export async function getAiBudget(now: Date = new Date()): Promise<AiBudgetView> {
  const { orgId } = await requireProviderOrg();
  const [ent, spent] = await Promise.all([getEntitlements(prisma, orgId, now), monthlyOrgSpend(orgId, now)]);
  return buildAiBudget(spent, ent.limits.maxAiBudgetCentsMonth);
}

/**
 * Medidores da 069 (alem dos 5 da 065): agentes ativos, custo de IA do mes, criativos do mes e membros. Cada um com limite efetivo (plano + override).
 * `limit: null` = ilimitado; `0` = nao incluido no plano.
 */
export async function getExtraUsage(now: Date = new Date()): Promise<UsageItem[]> {
  const { orgId } = await requireProviderOrg();
  const [ent, agents, spent, creatives, members] = await Promise.all([
    getEntitlements(prisma, orgId, now),
    prisma.agent.count({ where: { orgId, active: true } }),
    monthlyOrgSpend(orgId, now),
    prisma.creative.count({ where: { orgId, submittedAt: { gte: monthStart(now) } } }),
    prisma.membership.count({ where: { orgId } }),
  ]);
  const item = (metric: UsageItem["metric"], used: number, limit: number | null, unit?: "brl_cents"): UsageItem => ({ metric, ...METRIC_LABELS[metric], used, limit, ...(unit ? { unit } : {}) });
  return [
    item("agents", agents, ent.limits.maxActiveAgents),
    item("ai_budget", Math.round(spent / MICROS_PER_CENT), ent.limits.maxAiBudgetCentsMonth, "brl_cents"),
    item("creatives", creatives, ent.limits.maxCreativesPerMonth),
    item("members", members, ent.limits.maxMembers),
  ];
}

/** Para a faixa global do layout: so o PROPRIETARIO e so em 80%/100% do teto de IA do plano; senao `null`. Falha de leitura nunca derruba o layout (quem chama trata). */
export async function getAiBudgetAlert(now: Date = new Date()): Promise<AiBudgetView | null> {
  const { user, orgId } = await requireProviderOrg();
  const membership = await prisma.membership.findUnique({ where: { userId_orgId: { userId: user.id, orgId } }, select: { orgRole: true } });
  if (membership?.orgRole !== "owner") return null;
  const ent = await getEntitlements(prisma, orgId, now);
  const cap = ent.limits.maxAiBudgetCentsMonth;
  if (cap === null || cap <= 0 || ent.source === "blocked") return null;
  const b = buildAiBudget(await monthlyOrgSpend(orgId, now), cap);
  return b.state === "alert" || b.state === "exhausted" ? b : null;
}
