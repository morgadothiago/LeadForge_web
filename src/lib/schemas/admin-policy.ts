import { z } from "zod";
import { ALL_LIMIT_KEYS, isFeatureKey } from "@/lib/billing/plan-catalog";

/** SPEC-069c — entrada das actions de POLITICA por organizacao (so `platform_admin`; `src/lib/actions/admin/entitlements.ts`). */

const orgId = z.uuid("Organização inválida.");
/** Motivo OBRIGATORIO em toda mudanca de politica (AC-6: auditoria "quem/quando/antes/depois/motivo"). */
export const policyReason = z
  .string({ error: "Informe o motivo." })
  .trim()
  .min(5, "Informe um motivo com ao menos 5 caracteres.")
  .max(500, "Motivo deve ter no máximo 500 caracteres.");

/** `YYYY-MM-DD` (fim do dia, UTC) ou ISO 8601 completo. Passado/invalido = erro. */
function parseExpiry(v: string): Date | null {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T23:59:59.999Z`) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const expiresAt = z
  .preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string({ error: "Validade inválida." }).nullable().optional())
  .transform((v, ctx) => {
    if (v === null || v === undefined) return null;
    const d = parseExpiry(v);
    if (!d) {
      ctx.addIssue({ code: "custom", message: "Validade inválida." });
      return z.NEVER;
    }
    return d;
  });

export const setOrgEntitlementOverrideSchema = z
  .object({
    orgId,
    reason: policyReason,
    features: z.record(z.string(), z.boolean({ error: "Valor de funcionalidade inválido." })).default({}),
    limits: z.record(z.string(), z.number({ error: "Valor de limite inválido." }).int("Use número inteiro.").min(0, "Limite não pode ser negativo.").max(1_000_000_000).nullable()).default({}),
    /** Validade OPCIONAL (cliente piloto): vazio = sem prazo. Precisa ser futura (checada na action com o relogio injetado). */
    expiresAt,
  })
  .superRefine((d, ctx) => {
    for (const k of Object.keys(d.features)) if (!isFeatureKey(k)) ctx.addIssue({ code: "custom", path: ["features", k], message: `Funcionalidade desconhecida: ${k}.` });
    for (const k of Object.keys(d.limits)) if (!(ALL_LIMIT_KEYS as readonly string[]).includes(k)) ctx.addIssue({ code: "custom", path: ["limits", k], message: `Limite desconhecido: ${k}.` });
    if (!Object.keys(d.features).length && !Object.keys(d.limits).length) ctx.addIssue({ code: "custom", path: ["_form"], message: "Informe ao menos uma funcionalidade ou limite." });
  });

export const clearOrgEntitlementOverrideSchema = z.object({ orgId, reason: policyReason });

export const setOrgAgentSettingsSchema = z
  .object({
    orgId,
    reason: policyReason,
    killSwitch: z.boolean().optional(),
    /** `true` = o tenant nao consegue desligar o kill switch (so liga). */
    lockedByAdmin: z.boolean().optional(),
    monthlyBudgetCents: z.number().int().min(1, "Defina um teto maior que zero.").max(100_000_000).nullable().optional(),
  })
  .refine((d) => d.killSwitch !== undefined || d.lockedByAdmin !== undefined || d.monthlyBudgetCents !== undefined, { message: "Informe ao menos um campo para alterar.", path: ["_form"] });

export const setAgentPolicySchema = z
  .object({
    orgId,
    agentId: z.uuid("Agente inválido."),
    reason: policyReason,
    model: z.string().trim().min(1, "Informe o modelo.").max(60).regex(/^[A-Za-z0-9._:/-]+$/, "Modelo inválido (use letras, números e . _ : / -).").optional(),
    monthlyBudgetCents: z.number().int().min(1, "Defina um teto maior que zero.").max(10_000_000).nullable().optional(),
    dailyMessageLimit: z.number().int().min(1).max(500).optional(),
    maxTurnsPerLead: z.number().int().min(1).max(50).optional(),
  })
  .refine((d) => d.model !== undefined || d.monthlyBudgetCents !== undefined || d.dailyMessageLimit !== undefined || d.maxTurnsPerLead !== undefined, { message: "Informe ao menos um campo para alterar.", path: ["_form"] });

/** Base do cadastro de chave da plataforma: o resto (integration/name/value/baseUrl/allowPrivateHost) valida em `saveIntegrationSchema`. */
export const adminIntegrationBaseSchema = z.object({ orgId, reason: policyReason });
export const removeOrgIntegrationSchema = z.object({ orgId, reason: policyReason, id: z.uuid("Integração inválida.") });
export const orgPolicyIdSchema = orgId;
