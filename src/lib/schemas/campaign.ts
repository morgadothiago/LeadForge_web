import { z } from "zod";
import { icpInputSchema } from "./icp";

const optionalId = (label: string) =>
  z
    .uuid(`${label} inválido.`)
    .nullish()
    .transform((v) => v ?? null);

export const campaignStatusSchema = z.enum(["active", "paused", "archived"], {
  error: "Status inválido.",
});

const baseFields = {
  name: z
    .string({ error: "Nome da campanha é obrigatório." })
    .trim()
    .min(1, "Nome da campanha é obrigatório.")
    .max(120, "Nome da campanha deve ter no máximo 120 caracteres."),
  description: z
    .string()
    .trim()
    .max(1000, "Descrição deve ter no máximo 1000 caracteres.")
    .nullish()
    .transform((v) => (v ? v : null)),
  sequenceId: optionalId("Sequência"),
  whatsappInstanceId: optionalId("Instância de WhatsApp"),
  /** SPEC-013: início automático (default false = início explícito). Omitido na edição = não altera. */
  autoStart: z.boolean({ error: "Valor inválido para início automático." }).optional(),
};

/** ICP existente (icpId) ou inline (icp). Exatamente um dos dois. */
const icpChoice = z
  .object({
    icpId: z.uuid("ICP inválido.").optional(),
    icp: icpInputSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.icpId && !v.icp) {
      ctx.addIssue({ code: "custom", path: ["icpId"], message: "Selecione um ICP existente ou preencha um novo." });
    }
    if (v.icpId && v.icp) {
      ctx.addIssue({ code: "custom", path: ["icpId"], message: "Informe apenas um ICP: existente ou novo." });
    }
  });

export const campaignCreateSchema = z
  .object({ ...baseFields, status: campaignStatusSchema.default("active") })
  .and(icpChoice);
export type CampaignCreateInput = z.input<typeof campaignCreateSchema>;

/** Edição troca apenas o vínculo com ICP (icpId), sem ICP inline. */
export const campaignUpdateSchema = z.object({
  id: z.uuid("ID da campanha inválido."),
  ...baseFields,
  status: campaignStatusSchema,
  icpId: z.uuid("ICP inválido.", ),
});
export type CampaignUpdateInput = z.input<typeof campaignUpdateSchema>;

export const idSchema = z.uuid("ID inválido.");

export const campaignListParamsSchema = z.object({
  status: campaignStatusSchema.optional().catch(undefined),
  includeArchived: z.boolean().optional().default(false),
});
export type CampaignListParams = z.input<typeof campaignListParamsSchema>;
