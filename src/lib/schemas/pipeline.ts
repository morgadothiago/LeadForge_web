import { z } from "zod";

export const STAGES = [
  "novo_lead",
  "contactado",
  "em_followup",
  "interessado",
  "reuniao_agendada",
  "fechado",
  "perdido",
] as const;

export const stageSchema = z.enum(STAGES, { error: "Etapa inválida." });

export const moveOpportunitySchema = z.object({
  opportunityId: z.uuid("Oportunidade inválida."),
  toStage: stageSchema,
  toIndex: z.number({ error: "Posição inválida." }).int("Posição inválida.").min(0, "Posição inválida."),
  /** Escopo da coluna (filtro de campanha do board). Ausente = coluna global do stage. */
  campaignId: z.uuid("Campanha inválida.").optional(),
  /** Motivo da perda (opcional; só gravado quando toStage=perdido). Trim, máx 500, vazio -> null. */
  lostReason: z
    .string()
    .trim()
    .max(500, "Motivo deve ter no máximo 500 caracteres.")
    .nullable()
    .optional()
    .transform((v) => (v && v.length ? v : null)),
});
export type MoveOpportunityInput = z.infer<typeof moveOpportunitySchema>;

export const updateOpportunitySchema = z.object({
  opportunityId: z.uuid("Oportunidade inválida."),
  value: z
    .number({ error: "Valor inválido." })
    .min(0, "Valor não pode ser negativo.")
    .max(1_000_000_000, "Valor muito alto.")
    .nullable()
    .optional(),
  notes: z
    .string()
    .trim()
    .max(5000, "Notas devem ter no máximo 5000 caracteres.")
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v && v.length ? v : null)),
});
export type UpdateOpportunityInput = z.infer<typeof updateOpportunitySchema>;

export const boardParamsSchema = z.object({
  campaignId: z.uuid().optional().catch(undefined),
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .catch(undefined)
    .transform((v) => (v ? v : undefined)),
});
export type BoardParams = z.input<typeof boardParamsSchema>;
