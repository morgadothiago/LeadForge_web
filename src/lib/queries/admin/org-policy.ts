import type { AgentAutonomy, AgentRole, IntegrationKind, OrgStatus, SubscriptionStatus } from "@prisma/client";
import { requirePlatformAdmin } from "@/lib/auth/require-admin";
import { adminPrisma } from "@/lib/tenant/admin-prisma";
import { orgPolicyIdSchema } from "@/lib/schemas/admin-policy";
import { getEntitlements, type Entitlements } from "@/lib/billing/entitlements";
import { hostOf } from "@/lib/integrations/view";
import { FEATURE_CATALOG, NEW_LIMIT_CATALOG, PLAN_DISPLAY_NAMES, type PlanKey } from "@/lib/billing/plan-catalog";

/**
 * SPEC-069c — leitura da POLITICA de uma org para o admin (tela 069d). Somente `platform_admin`. So campos de politica: NUNCA persona/objetivo/tom/conhecimento,
 * leads ou conversas (D-069-2), e NUNCA o valor de chave (so `hint` mascarado + host mascarado).
 */
export interface OrgPolicyView {
  org: { id: string; name: string; status: OrgStatus };
  plan: { key: string | null; name: string | null; subscriptionStatus: SubscriptionStatus | null };
  /** Efetivo = plano + override ativo (ja resolvido pelo modulo `entitlements`). */
  effective: { features: Entitlements["features"]; limits: Entitlements["limits"]; source: Entitlements["source"]; paused: boolean; overrideActive: boolean; overrideExpiresAt: string | null };
  override: { features: Record<string, boolean>; limits: Record<string, number | null>; reason: string; expiresAt: string | null; createdBy: string; updatedAt: string } | null;
  agentSettings: { killSwitch: boolean; lockedByAdmin: boolean; monthlyBudgetCents: number | null };
  agents: { id: string; role: AgentRole; active: boolean; autonomy: AgentAutonomy; model: string; monthlyBudgetCents: number | null; dailyMessageLimit: number; maxTurnsPerLead: number }[];
  integrations: { id: string; integration: IntegrationKind; name: string; hint: string; hostMasked: string | null; allowPrivateHost: boolean; managedByPlatform: boolean; lastTestOk: boolean | null; updatedAt: string }[];
  platformLlmConfigured: boolean;
  catalog: { features: { key: string; label: string }[]; limits: { key: string; label: string }[] };
  audit: { id: string; adminUserId: string; action: string; reason: string | null; at: string; meta: unknown }[];
}

export async function getOrganizationPolicy(orgId: unknown): Promise<OrgPolicyView | null> {
  await requirePlatformAdmin();
  const id = orgPolicyIdSchema.safeParse(orgId);
  if (!id.success) return null;
  const org = await adminPrisma.organization.findUnique({ where: { id: id.data }, select: { id: true, name: true, status: true, subscription: { select: { status: true, plan: { select: { key: true } } } } } });
  if (!org) return null;
  const [ent, ov, settings, agents, secrets, audit] = await Promise.all([
    getEntitlements(adminPrisma, org.id),
    adminPrisma.orgEntitlementOverride.findUnique({ where: { orgId: org.id } }),
    adminPrisma.agentSettings.findUnique({ where: { orgId: org.id }, select: { killSwitch: true, lockedByAdmin: true, monthlyBudgetCents: true } }),
    adminPrisma.agent.findMany({ where: { orgId: org.id }, orderBy: [{ role: "asc" }, { createdAt: "asc" }], select: { id: true, role: true, active: true, autonomy: true, model: true, monthlyBudgetCents: true, dailyMessageLimit: true, maxTurnsPerLead: true } }),
    adminPrisma.integrationSecret.findMany({ where: { orgId: org.id }, orderBy: [{ integration: "asc" }, { name: "asc" }], select: { id: true, integration: true, name: true, hint: true, baseUrl: true, allowPrivateHost: true, managedByPlatform: true, lastTestOk: true, updatedAt: true } }),
    adminPrisma.platformAuditLog.findMany({ where: { orgId: org.id }, orderBy: { at: "desc" }, take: 50, select: { id: true, adminUserId: true, action: true, reason: true, at: true, meta: true } }),
  ]);
  const planKey = org.subscription?.plan.key ?? null;
  return {
    org: { id: org.id, name: org.name, status: org.status },
    plan: { key: planKey, name: planKey ? (PLAN_DISPLAY_NAMES[planKey as PlanKey] ?? planKey) : null, subscriptionStatus: org.subscription?.status ?? null },
    effective: { features: ent.features, limits: ent.limits, source: ent.source, paused: ent.paused, overrideActive: ent.overrideActive, overrideExpiresAt: ent.overrideExpiresAt?.toISOString() ?? null },
    override: ov ? { features: ov.features as Record<string, boolean>, limits: ov.limits as Record<string, number | null>, reason: ov.reason, expiresAt: ov.expiresAt?.toISOString() ?? null, createdBy: ov.createdBy, updatedAt: ov.updatedAt.toISOString() } : null,
    agentSettings: settings ?? { killSwitch: true, lockedByAdmin: false, monthlyBudgetCents: null },
    agents,
    integrations: secrets.map((s) => ({ id: s.id, integration: s.integration, name: s.name, hint: s.hint, hostMasked: hostOf(s.baseUrl), allowPrivateHost: s.allowPrivateHost, managedByPlatform: s.managedByPlatform, lastTestOk: s.lastTestOk, updatedAt: s.updatedAt.toISOString() })),
    platformLlmConfigured: !!(process.env.PLATFORM_LLM_API_KEY?.trim() || process.env.PLATFORM_LLM_BASE_URL?.trim()),
    catalog: {
      features: Object.entries(FEATURE_CATALOG).map(([key, v]) => ({ key, label: v.label })),
      limits: [{ key: "maxCampaigns", label: "Campanhas ativas" }, { key: "maxWhatsappInstances", label: "Números de WhatsApp" }, { key: "maxEmailAccounts", label: "Contas de e-mail" }, { key: "maxLeadsPerMonth", label: "Leads por mês" }, { key: "maxSendsPerDay", label: "Envios por dia" }, ...Object.entries(NEW_LIMIT_CATALOG).map(([key, v]) => ({ key, label: v.label }))],
    },
    audit: audit.map((a) => ({ id: a.id, adminUserId: a.adminUserId, action: a.action, reason: a.reason, at: a.at.toISOString(), meta: a.meta })),
  };
}
