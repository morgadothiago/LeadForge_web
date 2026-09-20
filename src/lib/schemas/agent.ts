import { z } from "zod";
import { ALL_TOOLS, escalationRulesSchema } from "@/lib/agents/types";

const text = (max: number) => z.string().trim().max(max, `Máximo de ${max} caracteres.`);

export const agentFieldsSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(80),
  persona: text(2000).default(""),
  objective: text(1000).default(""),
  tone: text(300).default(""),
  model: z.string().trim().min(1).max(60).default("claude-haiku-4-5"),
  samplePercent: z.number().int().min(0).max(100).default(20),
  monthlyBudgetCents: z.number().int().min(1, "Defina um teto maior que zero.").max(10_000_000).nullable().default(null),
  dailyMessageLimit: z.number().int().min(1).max(500).default(20),
  maxTurnsPerLead: z.number().int().min(1).max(50).default(5),
  allowedTools: z.array(z.enum(ALL_TOOLS)).default([]),
  escalationRules: escalationRulesSchema,
  minConfidence: z.number().min(0).max(1).default(0.6),
  disclosureEnabled: z.boolean().optional(),
  disclosureText: text(300).nullable().optional(),
  callLink: text(500).refine((v) => { try { const u = new URL(v); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; } }, "O link da call deve começar com https:// e não pode conter usuário/senha.").nullable().optional(),
});

export const createAgentSchema = agentFieldsSchema.extend({ role: z.enum(["sdr", "followup", "closer"]) });
/** Update parcial: sem `.default()` (campo ausente NAO pode voltar ao padrao), so o que foi enviado muda. */
const updateFieldsSchema = z.object({
  name: agentFieldsSchema.shape.name,
  persona: text(2000),
  objective: text(1000),
  tone: text(300),
  model: z.string().trim().min(1).max(60),
  samplePercent: z.number().int().min(0).max(100),
  monthlyBudgetCents: z.number().int().min(1, "Defina um teto maior que zero.").max(10_000_000).nullable(),
  dailyMessageLimit: z.number().int().min(1).max(500),
  maxTurnsPerLead: z.number().int().min(1).max(50),
  allowedTools: z.array(z.enum(ALL_TOOLS)),
  escalationRules: escalationRulesSchema.unwrap(),
  minConfidence: z.number().min(0).max(1),
  disclosureEnabled: z.boolean(),
  disclosureText: text(300).nullable(),
  callLink: agentFieldsSchema.shape.callLink,
}).partial();
export const updateAgentSchema = updateFieldsSchema.extend({ id: z.string().uuid() });
export const setActiveSchema = z.object({ id: z.string().uuid(), active: z.boolean() });
export const setAutonomySchema = z.object({
  id: z.string().uuid(),
  autonomy: z.enum(["draft", "sampled", "auto"]),
  /** Closer em auto: confirmação explícita + ciência do risco de banimento/LGPD. */
  confirmAuto: z.boolean().optional(),
  acknowledgeRisk: z.boolean().optional(),
});
export const globalSettingsSchema = z.object({ killSwitch: z.boolean().optional(), monthlyBudgetCents: z.number().int().min(1).max(100_000_000).nullable().optional() });
export const knowledgeSchema = z.object({
  id: z.string().uuid().optional(),
  agentId: z.string().uuid().nullable().default(null),
  title: z.string().trim().min(1, "Informe o título.").max(120),
  content: z.string().trim().min(1, "Informe o conteúdo.").max(20_000),
});
export const idSchema = z.object({ id: z.string().uuid() });
export const approveDraftSchema = z.object({ id: z.string().uuid(), editedBody: z.string().trim().min(1).max(4000).optional() });
export const rejectDraftSchema = z.object({ id: z.string().uuid(), reason: z.string().trim().min(1, "Informe o motivo.").max(300) });
export const bulkApproveSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(50) });
export const simulateSchema = z.object({ agentId: z.string().uuid(), leadId: z.string().uuid().optional(), inboundText: z.string().max(1000).optional() });
