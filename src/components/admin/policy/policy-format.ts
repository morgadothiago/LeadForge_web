import type { OrgPolicyView } from "@/lib/queries/admin/org-policy";

/** SPEC-069c (frontend) — funções puras da tela de política por organização (sem React; testadas em `policy-format.test.ts`). */

export type FeatureMode = "plan" | "on" | "off";
export type LimitMode = "plan" | "value" | "unlimited";
export interface LimitDraft {
  mode: LimitMode;
  value: string;
}
export interface OverrideDraft {
  features: Record<string, FeatureMode>;
  limits: Record<string, LimitDraft>;
  expiresAt: string;
  reason: string;
}

/** Estado inicial do formulário a partir do override gravado (o formulário sempre envia o ESTADO COMPLETO). */
export function overrideToDraft(policy: Pick<OrgPolicyView, "override" | "catalog">): OverrideDraft {
  const ov = policy.override;
  const features: Record<string, FeatureMode> = {};
  for (const f of policy.catalog.features) {
    const v = ov?.features[f.key];
    features[f.key] = v === true ? "on" : v === false ? "off" : "plan";
  }
  const limits: Record<string, LimitDraft> = {};
  for (const l of policy.catalog.limits) {
    const has = !!ov && Object.prototype.hasOwnProperty.call(ov.limits, l.key);
    const v = has ? ov!.limits[l.key] : undefined;
    limits[l.key] = !has ? { mode: "plan", value: "" } : v === null ? { mode: "unlimited", value: "" } : { mode: "value", value: String(v) };
  }
  return { features, limits, expiresAt: ov?.expiresAt ? ov.expiresAt.slice(0, 10) : "", reason: "" };
}

/** Monta o payload de `setOrgEntitlementOverride` (só o que foge do plano). Limite com valor inválido vira `NaN` (a validação do servidor recusa com mensagem). */
export function draftToPayload(orgId: string, d: OverrideDraft) {
  const features: Record<string, boolean> = {};
  for (const [k, m] of Object.entries(d.features)) if (m !== "plan") features[k] = m === "on";
  const limits: Record<string, number | null> = {};
  for (const [k, l] of Object.entries(d.limits)) {
    if (l.mode === "unlimited") limits[k] = null;
    else if (l.mode === "value") limits[k] = l.value.trim() === "" ? Number.NaN : Number(l.value.trim());
  }
  return { orgId, reason: d.reason, features, limits, expiresAt: d.expiresAt };
}

/** B2 (QA 069c): `true` quando TODO campo esta em "Seguir plano" (nada foge do plano): o servidor recusa; o cliente bloqueia antes com orientacao. */
export function isEmptyOverrideDraft(d: Pick<OverrideDraft, "features" | "limits">): boolean {
  return Object.values(d.features).every((m) => m === "plan") && Object.values(d.limits).every((l) => l.mode === "plan");
}

export function emptyOverrideMessage(hasExistingOverride: boolean): string {
  return hasExistingOverride
    ? "Todos os campos estão em “Seguir plano”: não há o que gravar. Para voltar a valer só o plano, use “Remover override”."
    : "Todos os campos estão em “Seguir plano”. Libere, bloqueie ou limite ao menos uma funcionalidade para gravar um override.";
}

/** B1 (QA 069c): valor inicial do checkbox "rede privada" = o gravado (`allowPrivateHost` nao e segredo); sem chave ainda = desmarcado. */
export const initialAllowPrivateHost = (existing: { allowPrivateHost: boolean } | undefined): boolean => existing?.allowPrivateHost ?? false;

/** B1: payload de rede privada. Envia SEMPRE o booleano (inclusive `false`) quando a integracao tem URL, para o admin conseguir DESLIGAR; sem URL, nada. */
export const allowPrivatePayload = (showUrl: boolean, checked: boolean): { allowPrivateHost?: boolean } => (showUrl ? { allowPrivateHost: checked } : {});

/** "12,50" ou "12.5" -> 1250 centavos; vazio -> null; inválido -> NaN. */
export function reaisToCents(s: string): number | null {
  const t = s.trim().replace(/^R\$\s*/, "");
  if (t === "") return null;
  if (!/^\d+([.,]\d{1,2})?$/.test(t)) return Number.NaN;
  return Math.round(Number(t.replace(",", ".")) * 100);
}

export const centsToReaisInput = (c: number | null): string => (c === null ? "" : (c / 100).toFixed(2).replace(".", ","));
export const formatBRL = (c: number): string => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const formatLimit = (v: number | null | undefined): string => (v === null ? "Ilimitado" : v === undefined ? "—" : String(v));

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  entitlement_override_set: "Override de plano gravado",
  entitlement_override_clear: "Override de plano removido",
  agent_settings_set: "Política da organização (kill switch/teto)",
  agent_policy_set: "Política de agente",
  integration_key_set: "Chave de integração gravada",
  integration_key_remove: "Integração removida",
};
export const AUDIT_AREA_LABELS: Record<string, string> = { override: "Plano e funcionalidades", agents: "Agentes e IA", agent: "Agente", integration: "Integrações" };

/** Campos alterados registrados no `meta` da auditoria (só nomes de campos de política; nunca valores de segredo). */
export function auditFields(meta: unknown): string[] {
  if (!meta || typeof meta !== "object") return [];
  const f = (meta as { fields?: unknown }).fields;
  return Array.isArray(f) ? f.filter((x): x is string => typeof x === "string") : [];
}

export const AGENT_ROLE_LABEL: Record<string, string> = { sdr: "SDR", followup: "Follow-up", closer: "Closer" };
export const AUTONOMY_LABEL: Record<string, string> = { draft: "Rascunho", sampled: "Amostragem", auto: "Automático" };
