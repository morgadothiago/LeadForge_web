import type { OrgStatus, SubscriptionStatus } from "@prisma/client";
import { resolveOrgAccess, type OrgAccessState } from "./access";
import { PlanLimitError, type Db, type ExtraLimitMetric } from "./limit-error";
import {
  ALL_LIMIT_KEYS,
  FEATURE_CATALOG,
  FEATURE_KEYS,
  FULL_ACCESS_PLAN_KEYS,
  NEW_LIMIT_CATALOG,
  PLAN_DISPLAY_NAMES,
  READ_ONLY_FEATURES,
  isFeatureKey,
  requiredPlanForFeature,
  type FeatureKey,
  type LimitKey,
  type NewLimitKey,
  type PlanKey,
} from "./plan-catalog";
import { parseFeatures, parseLimits } from "./plans";

export type { FeatureKey, LimitKey } from "./plan-catalog";

/**
 * SPEC-069a — MODULO UNICO de permissoes por plano (D-069-3). Nenhum outro arquivo pode comparar `plan.key`: toda checagem recebe `orgId`
 * e passa por aqui (`getEntitlements`, `assertFeature`, `assertWithinEntitlementLimit`). Valores vem de `plan-catalog.ts` -> seed -> `Plan.limits`.
 * Sem cache entre requests (o upgrade vale na hora, RNF). Relogio injetavel (`now`).
 *
 * Regras (D-069-9/10): sem Subscription (admin/seed) e `business`/`courtesy` = tudo liberado; plano ilegivel/erro = FAIL-CLOSED (so leitura);
 * `past_due` = plano vale, mas funcionalidades `costly` (IA) pausam; trial expirado/`soft_blocked` = so leitura. Override ativo prevalece
 * sobre o plano (exceto sobre o bloqueio de pagamento/assinatura).
 */

export type EntitlementSource = "none" | "full" | "plan" | "unknown_plan" | "blocked" | "error";
export type LockReason = "plan" | "past_due" | "blocked";

export interface Entitlements {
  orgId: string;
  planKey: string | null;
  source: EntitlementSource;
  access: OrgAccessState | null;
  /** `Subscription.status` (null = sem assinatura/erro). */
  subscriptionStatus: SubscriptionStatus | null;
  features: Record<FeatureKey, boolean>;
  /** `null` = ilimitado. */
  limits: Record<LimitKey, number | null>;
  /** `past_due`: IA/envio automatico pausados (D-069-10). */
  paused: boolean;
  overrideActive: boolean;
  overrideExpiresAt: Date | null;
}

/** Linha crua lida do banco (uma query). `resolveEntitlements` e PURA para o tick poder resolver por lote sem N+1 (069b). */
export interface EntitlementRow {
  status: OrgStatus;
  subscription: { status: SubscriptionStatus; pastDueSince: Date | null; cancelAtPeriodEnd: boolean; currentPeriodEnd: Date | null; trialEndsAt: Date | null; plan: { key: string; limits: unknown } } | null;
  entitlementOverride: { features: unknown; limits: unknown; expiresAt: Date | null } | null;
}

const boolMap = (v: boolean): Record<FeatureKey, boolean> => Object.fromEntries(FEATURE_KEYS.map((k) => [k, v])) as Record<FeatureKey, boolean>;
const limitMap = (v: number | null): Record<LimitKey, number | null> => Object.fromEntries(ALL_LIMIT_KEYS.map((k) => [k, v])) as Record<LimitKey, number | null>;

/** Somente leitura: nada de escrita/IA; limites novos que custam dinheiro/risco = 0. */
function lockedFeatures(): Record<FeatureKey, boolean> {
  const f = boolMap(false);
  for (const k of READ_ONLY_FEATURES) f[k] = true;
  return f;
}
function lockedLimits(base: Record<LimitKey, number | null>): Record<LimitKey, number | null> {
  const l = { ...base };
  for (const k of Object.keys(NEW_LIMIT_CATALOG) as NewLimitKey[]) if (NEW_LIMIT_CATALOG[k].absent === "zero") l[k] = 0;
  return l;
}

function base(orgId: string, subscriptionStatus: SubscriptionStatus | null = null): Pick<Entitlements, "orgId" | "paused" | "overrideActive" | "overrideExpiresAt" | "subscriptionStatus"> {
  return { orgId, subscriptionStatus, paused: false, overrideActive: false, overrideExpiresAt: null };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function resolveEntitlements(orgId: string, row: EntitlementRow | null, now: Date): Entitlements {
  // Org inexistente: nada liberado alem de leitura (fail-closed).
  if (!row) return { ...base(orgId), planKey: null, source: "error", access: null, features: lockedFeatures(), limits: lockedLimits(limitMap(null)) };
  const sub = row.subscription;
  if (!sub) {
    const access = resolveOrgAccess(null, row, now);
    if (access === "sem_assinatura") return { ...base(orgId), planKey: null, source: "none", access, features: boolMap(true), limits: limitMap(null) };
    return { ...base(orgId), planKey: null, source: "blocked", access, features: lockedFeatures(), limits: lockedLimits(limitMap(null)) };
  }
  const planKey = sub.plan.key;
  const access = resolveOrgAccess(sub, row, now);
  // Business/courtesy liberam tudo, MAS org suspensa ou assinatura cancelada/bloqueada cai no ramo bloqueado (so leitura). Courtesy SEM
  // assinatura segue liberada (ramo `!sub` acima). Decisao do QA 069a.
  if (FULL_ACCESS_PLAN_KEYS.includes(planKey) && access !== "soft_blocked" && access !== "trial_expirado") {
    return { ...base(orgId, sub.status), planKey, source: "full", access, features: boolMap(true), limits: limitMap(null) };
  }
  // Trial expirado / suspensa / cancelada: bloqueio total ja existente (065), so leitura.
  if (access === "trial_expirado" || access === "soft_blocked") return { ...base(orgId, sub.status), planKey, source: "blocked", access, features: lockedFeatures(), limits: lockedLimits(parseLimits(sub.plan.limits)) };
  // Plano ilegivel (JSON invalido): fail-closed.
  if (!isObj(sub.plan.limits)) return { ...base(orgId, sub.status), planKey, source: "unknown_plan", access, features: lockedFeatures(), limits: lockedLimits(parseLimits(null)) };

  const features = parseFeatures(sub.plan.limits);
  const limits: Record<LimitKey, number | null> = { ...parseLimits(sub.plan.limits) };

  // Override (prevalece sobre o plano enquanto valido).
  const ov = row.entitlementOverride;
  const overrideActive = !!ov && (ov.expiresAt === null || ov.expiresAt.getTime() > now.getTime());
  if (overrideActive && ov) {
    if (isObj(ov.features)) for (const [k, v] of Object.entries(ov.features)) if (isFeatureKey(k) && typeof v === "boolean") features[k] = v;
    if (isObj(ov.limits)) {
      for (const [k, v] of Object.entries(ov.limits)) {
        if (!(ALL_LIMIT_KEYS as readonly string[]).includes(k)) continue;
        if (v === null) limits[k as LimitKey] = null;
        else if (typeof v === "number" && Number.isFinite(v) && v >= 0) limits[k as LimitKey] = v;
      }
    }
  }

  // past_due: o plano vale, mas IA (costly) pausa (D-069-10); aplicado DEPOIS do override (nao ha override que libere IA sem pagamento).
  const paused = access === "pago_em_atraso";
  if (paused) {
    for (const k of FEATURE_KEYS) if (FEATURE_CATALOG[k].costly) features[k] = false;
    limits.maxActiveAgents = 0;
    limits.maxAiBudgetCentsMonth = 0;
    limits.maxAgentMessagesPerDay = 0;
  }
  return { orgId, subscriptionStatus: sub.status, planKey, source: "plan", access, features, limits, paused, overrideActive, overrideExpiresAt: overrideActive ? (ov?.expiresAt ?? null) : null };
}

/** Le a org (uma query) e resolve. Erro de leitura => FAIL-CLOSED (so leitura), nunca lanca. */
export async function getEntitlements(db: Db, orgId: string, now: Date = new Date()): Promise<Entitlements> {
  try {
    const row = await db.organization.findUnique({
      where: { id: orgId },
      select: {
        status: true,
        subscription: { select: { status: true, pastDueSince: true, cancelAtPeriodEnd: true, currentPeriodEnd: true, trialEndsAt: true, plan: { select: { key: true, limits: true } } } },
        entitlementOverride: { select: { features: true, limits: true, expiresAt: true } },
      },
    });
    return resolveEntitlements(orgId, row, now);
  } catch {
    console.error("[entitlements] falha ao ler o plano da organização; aplicando bloqueio seguro.");
    return resolveEntitlements(orgId, null, now);
  }
}

/**
 * SPEC-069b — defesa em profundidade (D-069-9/10): `true` quando o plano NAO pode ser confiado para operacoes que custam dinheiro/risco
 * (IA, envio, geracao de criativo): leitura do plano falhou, plano ilegivel/desconhecido, org bloqueada (trial expirado/suspensa/cancelada)
 * ou `past_due` (pausa). Leitura nunca e barrada por isto.
 */
export function isCostlyBlocked(ent: Entitlements): boolean {
  return ent.paused || ent.source === "error" || ent.source === "unknown_plan" || ent.source === "blocked";
}

const ROLE_FEATURE: Record<"sdr" | "followup" | "closer", FeatureKey> = { sdr: "agents.role.sdr", followup: "agents.role.followup", closer: "agents.role.closer" };
const AUTONOMY_FEATURE: Record<"draft" | "sampled" | "auto", FeatureKey> = { draft: "agents.autonomy.draft", sampled: "agents.autonomy.sample", auto: "agents.autonomy.auto" };
/** Feature do papel de agente (`sdr|followup|closer`). Papel desconhecido = a mais restritiva (Closer). */
export const agentRoleFeature = (role: string): FeatureKey => ROLE_FEATURE[role as keyof typeof ROLE_FEATURE] ?? "agents.role.closer";
/** Feature do modo de autonomia (`draft|sampled|auto`). Desconhecido = o mais restritivo (auto). */
export const agentAutonomyFeature = (autonomy: string): FeatureKey => AUTONOMY_FEATURE[autonomy as keyof typeof AUTONOMY_FEATURE] ?? "agents.autonomy.auto";

export function hasFeature(ent: Entitlements, feature: FeatureKey): boolean {
  return ent.features[feature] === true;
}

export function limitOf(ent: Entitlements, key: LimitKey): number | null {
  return ent.limits[key];
}

/** Nome (PT-BR) do menor plano que libera a funcionalidade segundo a matriz. */
export function requiredPlanName(feature: FeatureKey): string {
  return PLAN_DISPLAY_NAMES[requiredPlanForFeature(feature)];
}

function lockMessage(feature: FeatureKey, requiredPlan: string, reason: LockReason): string {
  const label = FEATURE_CATALOG[feature].label;
  if (reason === "past_due") return `${label} está pausado por pagamento em atraso. Regularize em Configurações > Assinatura.`;
  if (reason === "blocked") return `${label} indisponível: assinatura inativa ou teste encerrado. Veja Configurações > Assinatura.`;
  return `${label}: disponível no plano ${requiredPlan}. Faça upgrade para usar.`;
}

/** Erro tipado `plan_feature_locked` (D-069 secao C). `handleActionError` o converte em `errors._form` + `code:["plan_feature_locked"]` + `feature/requiredPlan`. Nao vaza dado de outra org. */
export class PlanFeatureLockedError extends Error {
  readonly code = "plan_feature_locked" as const;
  readonly requiredPlan: string;
  constructor(
    readonly feature: FeatureKey,
    readonly reason: LockReason = "plan",
  ) {
    const requiredPlan = requiredPlanName(feature);
    super(lockMessage(feature, requiredPlan, reason));
    this.name = "PlanFeatureLockedError";
    this.requiredPlan = requiredPlan;
  }
}

/** Lanca `PlanFeatureLockedError` se a org nao tem a funcionalidade. Chamar no SERVIDOR (UI esconder nao basta). */
export async function assertFeature(db: Db, orgId: string, feature: FeatureKey, now: Date = new Date()): Promise<void> {
  assertFeatureIn(await getEntitlements(db, orgId, now), feature);
}

/** Variante sincrona sobre entitlements ja resolvidos (tick por lote, 069b). */
export function assertFeatureIn(ent: Entitlements, feature: FeatureKey): void {
  if (hasFeature(ent, feature)) return;
  const reason: LockReason = ent.source === "blocked" || ent.source === "error" || ent.source === "unknown_plan" ? "blocked" : ent.paused && FEATURE_CATALOG[feature].costly ? "past_due" : "plan";
  throw new PlanFeatureLockedError(feature, reason);
}

const EXTRA_KEY: Record<ExtraLimitMetric, NewLimitKey> = {
  agents: "maxActiveAgents",
  ai_budget: "maxAiBudgetCentsMonth",
  agent_messages: "maxAgentMessagesPerDay",
  lead_searches: "maxLeadSearchesPerDay",
  creatives: "maxCreativesPerMonth",
  members: "maxMembers",
  sequence_steps: "maxSequenceSteps",
};

/**
 * Limite numerico novo (agentes, equipe, criativos...): `current` = contagem atual; lanca `PlanLimitError` (`plan_limit`) se `current + adding`
 * passar do limite efetivo (plano + override). Para estoque, chamar DENTRO da transacao apos `lockOrg`.
 */
export async function assertWithinEntitlementLimit(db: Db, orgId: string, metric: ExtraLimitMetric, current: number, adding = 1, now: Date = new Date()): Promise<void> {
  const limit = limitOf(await getEntitlements(db, orgId, now), EXTRA_KEY[metric]);
  if (limit === null) return;
  if (current + adding > limit) throw new PlanLimitError(metric, limit, current);
}

export type { PlanKey };
