import type { Prisma } from "@prisma/client";
import { adminPrisma } from "@/lib/tenant/admin-prisma";
import { encrypt } from "@/lib/crypto/secret-box";
import { getEncryptionKey } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { invalidateIntegrationCache } from "@/lib/integrations/config";
import { assertAllowedHost, parseIntegrationUrl } from "@/lib/integrations/url-guard";
import { hostOf, SELECT_ITEM } from "@/lib/integrations/view";
import type { IntegrationKindName } from "@/lib/integrations/types";
import { saveIntegrationSchema, secretHint } from "@/lib/schemas/integration";
import { adminIntegrationBaseSchema, clearOrgEntitlementOverrideSchema, removeOrgIntegrationSchema, setAgentPolicySchema, setOrgAgentSettingsSchema, setOrgEntitlementOverrideSchema } from "@/lib/schemas/admin-policy";
import { failure, formError, success, zodErrors, type ActionResult } from "@/lib/actions/result";
import { recordOrgAudit } from "@/lib/org/audit";

/**
 * SPEC-069c — NUCLEO da escrita de POLITICA por organizacao pelo `platform_admin` (D-069-1/2). So e chamado pelas actions de
 * `src/lib/actions/admin/entitlements.ts` APOS `requirePlatformAdmin()`; nunca exportado como Server Action. Toda mudanca grava, na MESMA transacao,
 * `PlatformAuditLog` (quem/quando/acao/motivo + `meta` antes/depois) e `OrgAuditLog` (efeito na org). NUNCA grava segredo (valor/hint) nem conteudo/dado operacional do
 * tenant (persona, conhecimento, leads, conversas): so campos de politica. Relogio injetavel (`now`) para a validade do override.
 */

const NOT_FOUND = "Organização não encontrada.";
type Tx = Prisma.TransactionClient;
type Json = Prisma.InputJsonValue;

async function orgExists(orgId: string): Promise<boolean> {
  return !!(await adminPrisma.organization.findUnique({ where: { id: orgId }, select: { id: true } }));
}

async function audit(
  tx: Tx,
  e: { adminId: string; orgId: string; action: "entitlement_override_set" | "entitlement_override_clear" | "agent_settings_set" | "agent_policy_set" | "integration_key_set" | "integration_key_remove"; reason: string; area: string; fields: string[]; before: Json | null; after: Json | null },
): Promise<void> {
  await tx.platformAuditLog.create({
    data: { adminUserId: e.adminId, orgId: e.orgId, action: e.action, reason: e.reason, meta: { area: e.area, fields: e.fields, before: e.before, after: e.after } as Json },
  });
  await recordOrgAudit(tx, { orgId: e.orgId, actorUserId: e.adminId, action: "admin_policy_changed", meta: { area: e.area, fields: e.fields } });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Override de funcionalidades/limites (OrgEntitlementOverride)
// ---------------------------------------------------------------------------------------------------------------------------------
export interface OverrideView {
  orgId: string;
  features: Record<string, boolean>;
  limits: Record<string, number | null>;
  reason: string;
  expiresAt: string | null;
  updatedAt: string;
}
const overrideSnapshot = (o: { features: unknown; limits: unknown; reason: string; expiresAt: Date | null }): Json => ({ features: o.features as Json, limits: o.limits as Json, reason: o.reason, expiresAt: o.expiresAt?.toISOString() ?? null });
const toOverrideView = (o: { orgId: string; features: unknown; limits: unknown; reason: string; expiresAt: Date | null; updatedAt: Date }): OverrideView => ({
  orgId: o.orgId, features: o.features as Record<string, boolean>, limits: o.limits as Record<string, number | null>, reason: o.reason, expiresAt: o.expiresAt?.toISOString() ?? null, updatedAt: o.updatedAt.toISOString(),
});

/** Cria/substitui o override da org (o formulario envia o estado COMPLETO). Motivo obrigatorio; validade opcional e futura. */
export async function setOverride(adminId: string, input: unknown, now: Date = new Date()): Promise<ActionResult<OverrideView>> {
  const parsed = setOrgEntitlementOverrideSchema.safeParse(input);
  if (!parsed.success) return failure(zodErrors(parsed.error));
  const { orgId, reason, features, limits, expiresAt } = parsed.data;
  if (expiresAt && expiresAt.getTime() <= now.getTime()) return failure({ expiresAt: ["A validade precisa ser uma data futura."] });
  if (!(await orgExists(orgId))) return formError(NOT_FOUND);
  const row = await adminPrisma.$transaction(async (tx) => {
    const before = await tx.orgEntitlementOverride.findUnique({ where: { orgId } });
    const data = { features: features as Json, limits: limits as Json, reason, expiresAt, createdBy: adminId };
    const saved = await tx.orgEntitlementOverride.upsert({ where: { orgId }, create: { orgId, ...data }, update: data });
    await audit(tx, {
      adminId, orgId, action: "entitlement_override_set", reason, area: "override",
      fields: [...Object.keys(features), ...Object.keys(limits)], before: before ? overrideSnapshot(before) : null, after: overrideSnapshot(saved),
    });
    return saved;
  });
  return success(toOverrideView(row));
}

/** Remove o override (a org volta a valer so o plano). Motivo obrigatorio. */
export async function clearOverride(adminId: string, input: unknown): Promise<ActionResult<{ orgId: string }>> {
  const parsed = clearOrgEntitlementOverrideSchema.safeParse(input);
  if (!parsed.success) return failure(zodErrors(parsed.error));
  const { orgId, reason } = parsed.data;
  if (!(await orgExists(orgId))) return formError(NOT_FOUND);
  const found = await adminPrisma.$transaction(async (tx) => {
    const before = await tx.orgEntitlementOverride.findUnique({ where: { orgId } });
    if (!before) return false;
    await tx.orgEntitlementOverride.delete({ where: { orgId } });
    await audit(tx, { adminId, orgId, action: "entitlement_override_clear", reason, area: "override", fields: [...Object.keys(before.features as object), ...Object.keys(before.limits as object)], before: overrideSnapshot(before), after: null });
    return true;
  });
  if (!found) return formError("Esta organização não tem override.");
  return success({ orgId });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Kill switch / teto da ORG (AgentSettings)
// ---------------------------------------------------------------------------------------------------------------------------------
export interface OrgAgentSettingsView { orgId: string; killSwitch: boolean; lockedByAdmin: boolean; monthlyBudgetCents: number | null }

/** Kill switch da org (ligar/desligar), TRAVA (`lockedByAdmin`: o tenant so liga) e teto de custo da org. Q-069-3. */
export async function setOrgAgentSettings(adminId: string, input: unknown): Promise<ActionResult<OrgAgentSettingsView>> {
  const parsed = setOrgAgentSettingsSchema.safeParse(input);
  if (!parsed.success) return failure(zodErrors(parsed.error));
  const { orgId, reason, ...patch } = parsed.data;
  if (!(await orgExists(orgId))) return formError(NOT_FOUND);
  const data = {
    ...(patch.killSwitch !== undefined ? { killSwitch: patch.killSwitch } : {}),
    ...(patch.lockedByAdmin !== undefined ? { lockedByAdmin: patch.lockedByAdmin } : {}),
    ...(patch.monthlyBudgetCents !== undefined ? { monthlyBudgetCents: patch.monthlyBudgetCents } : {}),
    updatedBy: adminId,
  };
  const row = await adminPrisma.$transaction(async (tx) => {
    const before = await tx.agentSettings.findUnique({ where: { orgId }, select: { killSwitch: true, lockedByAdmin: true, monthlyBudgetCents: true } });
    const saved = await tx.agentSettings.upsert({ where: { orgId }, create: { orgId, ...data }, update: data, select: { killSwitch: true, lockedByAdmin: true, monthlyBudgetCents: true } });
    await audit(tx, {
      adminId, orgId, action: "agent_settings_set", reason, area: "agent_settings",
      fields: Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined),
      before: before ?? { killSwitch: true, lockedByAdmin: false, monthlyBudgetCents: null }, after: saved,
    });
    return saved;
  });
  return success({ orgId, ...row });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Politica por AGENTE (modelo, teto, mensagens/dia, turnos). Nunca persona/objetivo/tom/conhecimento (conteudo do tenant).
// ---------------------------------------------------------------------------------------------------------------------------------
export interface AgentPolicyView { agentId: string; model: string; monthlyBudgetCents: number | null; dailyMessageLimit: number; maxTurnsPerLead: number }

export async function setAgentPolicy(adminId: string, input: unknown): Promise<ActionResult<AgentPolicyView>> {
  const parsed = setAgentPolicySchema.safeParse(input);
  if (!parsed.success) return failure(zodErrors(parsed.error));
  const { orgId, agentId, reason, ...patch } = parsed.data;
  const SELECT = { id: true, role: true, model: true, monthlyBudgetCents: true, dailyMessageLimit: true, maxTurnsPerLead: true } as const;
  const out = await adminPrisma.$transaction(async (tx) => {
    // O agente tem que ser DESTA org (nunca confirma a existencia de agente de outra org).
    const before = await tx.agent.findFirst({ where: { id: agentId, orgId }, select: SELECT });
    if (!before) return null;
    const data = {
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.monthlyBudgetCents !== undefined ? { monthlyBudgetCents: patch.monthlyBudgetCents } : {}),
      ...(patch.dailyMessageLimit !== undefined ? { dailyMessageLimit: patch.dailyMessageLimit } : {}),
      ...(patch.maxTurnsPerLead !== undefined ? { maxTurnsPerLead: patch.maxTurnsPerLead } : {}),
      updatedBy: adminId,
    };
    const saved = await tx.agent.update({ where: { id: agentId }, data, select: SELECT });
    const pick = (a: typeof before) => ({ agentId: a.id, role: a.role, model: a.model, monthlyBudgetCents: a.monthlyBudgetCents, dailyMessageLimit: a.dailyMessageLimit, maxTurnsPerLead: a.maxTurnsPerLead });
    await audit(tx, { adminId, orgId, action: "agent_policy_set", reason, area: "agent_policy", fields: Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined), before: pick(before), after: pick(saved) });
    return saved;
  });
  if (!out) return formError("Agente não encontrado.");
  return success({ agentId, model: out.model, monthlyBudgetCents: out.monthlyBudgetCents, dailyMessageLimit: out.dailyMessageLimit, maxTurnsPerLead: out.maxTurnsPerLead });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Chaves/integracoes da PLATAFORMA gravadas para uma org (`managedByPlatform = true`)
// ---------------------------------------------------------------------------------------------------------------------------------
/**
 * Grava (cria/gira/atualiza URL) a chave de uma integracao PARA a org, como chave da plataforma (o tenant nao edita nem remove). `value` e write-only: nunca volta,
 * nunca vai a log/auditoria/erro (so `hostMasked`). Mesmas travas de URL/SSRF do cadastro do tenant.
 */
/** SPEC-069d (M1): o que volta ao navegador do admin apos gravar a chave: so ids, host MASCARADO e a dica; NUNCA a URL completa nem o valor da chave. */
export interface SavedOrgIntegrationView { id: string; integration: IntegrationKindName; name: string; hint: string; hostMasked: string | null; allowPrivateHost: boolean }

export async function saveOrgIntegration(adminId: string, input: unknown): Promise<ActionResult<SavedOrgIntegrationView>> {
  const base = adminIntegrationBaseSchema.safeParse(input);
  if (!base.success) return failure(zodErrors(base.error));
  const parsed = saveIntegrationSchema.safeParse(input);
  if (!parsed.success) return failure(zodErrors(parsed.error));
  const { orgId, reason } = base.data;
  const { integration, name, value } = parsed.data;
  if (!(await orgExists(orgId))) return formError(NOT_FOUND);
  const where = { orgId_integration_name: { orgId, integration, name } };
  const existing = await adminPrisma.integrationSecret.findUnique({ where });
  if (!existing && !value && !(integration === "llm" && parsed.data.baseUrl)) return failure({ value: ["Informe a chave."] });
  const allowPrivateHost = parsed.data.allowPrivateHost ?? existing?.allowPrivateHost ?? false;
  let baseUrl: string | null = existing?.baseUrl ?? null;
  if (parsed.data.baseUrl) {
    try {
      baseUrl = parseIntegrationUrl(parsed.data.baseUrl).url;
    } catch (e) {
      if (e instanceof AppError) return failure({ baseUrl: [e.userMessage] });
      throw e;
    }
  }
  if (baseUrl) {
    try {
      await assertAllowedHost(parseIntegrationUrl(baseUrl).hostname, allowPrivateHost);
    } catch (e) {
      if (e instanceof AppError) return failure({ baseUrl: [e.userMessage] });
      throw e;
    }
  }
  // Trocar o host do LLM sem nova chave NAO reaproveita a chave antiga (nao enviar a chave de um provedor a outro host).
  const clearKey = integration === "llm" && !!existing && !value && !!baseUrl && existing.baseUrl !== baseUrl;
  if (value || !existing || clearKey) {
    try {
      getEncryptionKey();
    } catch {
      return formError("ENCRYPTION_KEY não configurada/inválida no ambiente do servidor. Configure-a antes de cadastrar chaves.");
    }
  }
  const hostMasked = hostOf(baseUrl);
  const row = await adminPrisma.$transaction(async (tx) => {
    const cur = await tx.integrationSecret.findUnique({ where });
    const urlChanged = !cur || cur.baseUrl !== baseUrl || cur.allowPrivateHost !== allowPrivateHost;
    const secret = clearKey ? { encryptedValue: encrypt(""), hint: "", lastTestedAt: null, lastTestOk: null, lastTestError: null } : value ? { encryptedValue: encrypt(value), hint: secretHint(value), lastTestedAt: null, lastTestOk: null, lastTestError: null } : {};
    const saved = cur
      ? await tx.integrationSecret.update({ where: { id: cur.id }, data: { ...secret, baseUrl, allowPrivateHost, managedByPlatform: true, updatedById: adminId, ...(urlChanged && !value ? { lastTestedAt: null, lastTestOk: null, lastTestError: null } : {}) }, select: SELECT_ITEM })
      : await tx.integrationSecret.create({ data: { orgId, integration, name, encryptedValue: encrypt(value ?? ""), hint: secretHint(value ?? ""), baseUrl, allowPrivateHost, managedByPlatform: true, updatedById: adminId }, select: SELECT_ITEM });
    const kinds = [...(!cur ? ["create" as const] : value || clearKey ? ["rotate" as const] : []), ...(cur && urlChanged ? ["update_url" as const] : [])];
    for (const action of kinds) {
      await tx.integrationAuditLog.create({ data: { orgId, userId: adminId, integration, action, hostMasked, allowPrivateHost: baseUrl ? allowPrivateHost : null } });
    }
    await audit(tx, {
      adminId, orgId, action: "integration_key_set", reason, area: "integration", fields: [integration, ...kinds],
      before: cur ? { integration, name, managedByPlatform: cur.managedByPlatform, hostMasked: hostOf(cur.baseUrl) } : null,
      after: { integration, name, managedByPlatform: true, hostMasked, allowPrivateHost: baseUrl ? allowPrivateHost : null, rotated: !!value || clearKey },
    });
    return saved;
  });
  invalidateIntegrationCache(orgId);
  return success({ id: row.id, integration: row.integration as IntegrationKindName, name: row.name, hint: row.hint, hostMasked: hostOf(row.baseUrl), allowPrivateHost: row.allowPrivateHost });
}

export async function removeOrgIntegration(adminId: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = removeOrgIntegrationSchema.safeParse(input);
  if (!parsed.success) return failure(zodErrors(parsed.error));
  const { orgId, reason, id } = parsed.data;
  const out = await adminPrisma.$transaction(async (tx) => {
    const row = await tx.integrationSecret.findFirst({ where: { id, orgId }, select: { id: true, integration: true, name: true, baseUrl: true, managedByPlatform: true } });
    if (!row) return { kind: "missing" as const };
    if (row.integration === "evolution") {
      const n = await tx.whatsAppInstance.count({ where: { orgId, provider: "evolution" } });
      if (n > 0) return { kind: "blocked" as const, n };
    }
    await tx.integrationSecret.delete({ where: { id: row.id } });
    await tx.integrationAuditLog.create({ data: { orgId, userId: adminId, integration: row.integration, action: "delete", hostMasked: hostOf(row.baseUrl) } });
    await audit(tx, { adminId, orgId, action: "integration_key_remove", reason, area: "integration", fields: [row.integration], before: { integration: row.integration, name: row.name, managedByPlatform: row.managedByPlatform, hostMasked: hostOf(row.baseUrl) }, after: null });
    return { kind: "ok" as const, id: row.id };
  });
  if (out.kind === "missing") return formError("Integração não encontrada.");
  if (out.kind === "blocked") return formError(`Não é possível remover: ${out.n} instância${out.n > 1 ? "s" : ""} de WhatsApp depende${out.n > 1 ? "m" : ""} da Evolution.`);
  invalidateIntegrationCache(orgId);
  return success({ id: out.id });
}
