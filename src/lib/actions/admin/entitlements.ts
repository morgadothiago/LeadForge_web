"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth/require-admin";
import { clearOverride, removeOrgIntegration, saveOrgIntegration, setAgentPolicy, setOrgAgentSettings, setOverride, type AgentPolicyView, type OrgAgentSettingsView, type OverrideView } from "@/lib/admin/org-policy";
import type { IntegrationItemView } from "@/lib/integrations/view";
import { safeAction, type ActionResult } from "@/lib/actions/result";

/**
 * SPEC-069c — actions de POLITICA por organizacao (D-069-1/2): SO `platform_admin` (`requirePlatformAdmin()` ANTES de qualquer acesso a banco; nunca o tenant,
 * nem `requireProviderOrg`/`scopedPrisma`). O `orgId` vem do input (o ator e a plataforma, nao o dono da org). Motivo obrigatorio em tudo; auditoria
 * (`PlatformAuditLog` + `OrgAuditLog`, antes/depois, sem segredo) gravada na mesma transacao pelo nucleo `src/lib/admin/org-policy.ts`.
 * Sem acesso a leads/conversas: so campos de politica (override, kill switch/teto, modelo/teto/limites por agente, chaves de integracao com `hint`).
 */
const revalidate = (orgId: unknown): void => {
  if (typeof orgId === "string") revalidatePath(`/admin/organizacoes/${orgId}`);
};
const orgOf = (input: unknown): unknown => (input && typeof input === "object" ? (input as { orgId?: unknown }).orgId : undefined);

/** Cria/substitui o override de funcionalidades/limites da org (motivo obrigatorio, validade opcional e futura). */
export async function setOrgEntitlementOverride(input: unknown): Promise<ActionResult<OverrideView>> {
  return safeAction(async () => {
    const { user } = await requirePlatformAdmin();
    const r = await setOverride(user.id, input);
    if (r.ok) revalidate(orgOf(input));
    return r;
  });
}

/** Remove o override da org (volta a valer so o plano). */
export async function clearOrgEntitlementOverride(input: unknown): Promise<ActionResult<{ orgId: string }>> {
  return safeAction(async () => {
    const { user } = await requirePlatformAdmin();
    const r = await clearOverride(user.id, input);
    if (r.ok) revalidate(orgOf(input));
    return r;
  });
}

/** Kill switch da org, trava (`lockedByAdmin`) e teto de custo mensal da org. */
export async function setOrgAgentSettingsByAdmin(input: unknown): Promise<ActionResult<OrgAgentSettingsView>> {
  return safeAction(async () => {
    const { user } = await requirePlatformAdmin();
    const r = await setOrgAgentSettings(user.id, input);
    if (r.ok) revalidate(orgOf(input));
    return r;
  });
}

/** Politica de UM agente da org: modelo, teto mensal, mensagens/dia, turnos por lead. */
export async function setAgentPolicyByAdmin(input: unknown): Promise<ActionResult<AgentPolicyView>> {
  return safeAction(async () => {
    const { user } = await requirePlatformAdmin();
    const r = await setAgentPolicy(user.id, input);
    if (r.ok) revalidate(orgOf(input));
    return r;
  });
}

/** Grava/gira a chave de uma integracao (LLM da plataforma, Places, Evolution, n8n) para a org, como chave da PLATAFORMA. Write-only; so `hint` volta. */
export async function saveOrgIntegrationByAdmin(input: unknown): Promise<ActionResult<IntegrationItemView>> {
  return safeAction(async () => {
    const { user } = await requirePlatformAdmin();
    const r = await saveOrgIntegration(user.id, input);
    if (r.ok) revalidate(orgOf(input));
    return r;
  });
}

/** Remove uma integracao da org (bloqueia a Evolution com numeros de WhatsApp pendurados). */
export async function removeOrgIntegrationByAdmin(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const { user } = await requirePlatformAdmin();
    const r = await removeOrgIntegration(user.id, input);
    if (r.ok) revalidate(orgOf(input));
    return r;
  });
}
