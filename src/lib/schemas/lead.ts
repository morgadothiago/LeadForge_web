import { z } from "zod";
import { CHANNELS, STAGES } from "@/lib/domain";
import { normalizeBrPhone } from "@/lib/domain/phone";

export const MIN_CONTACT_MSG = "Informe ao menos um contato: e-mail ou telefone.";
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 30;

const optText = (label: string, max: number) =>
  z
    .string({ error: `${label} inválido.` })
    .trim()
    .max(max, `${label} deve ter no máximo ${max} caracteres.`)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v && v.length ? v : null));

const emailField = z
  .string({ error: "E-mail inválido." })
  .trim()
  .toLowerCase()
  .max(254, "E-mail deve ter no máximo 254 caracteres.")
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v && v.length ? v : null))
  .refine((v) => v == null || z.email().safeParse(v).success, "E-mail inválido.");

const phoneField = z
  .string({ error: "Telefone inválido." })
  .trim()
  .nullable()
  .optional()
  .transform((v, ctx): string | null | undefined => {
    if (v === undefined) return undefined;
    if (!v) return null;
    const r = normalizeBrPhone(v);
    if (!r.ok) {
      ctx.addIssue({ code: "custom", message: r.error });
      return z.NEVER;
    }
    return r.e164;
  });

const urlField = (label: string) =>
  optText(label, 300).refine(
    (v) => v == null || /^https?:\/\/\S+$/i.test(v),
    `${label} inválido. Use um endereço começando com http:// ou https://.`,
  );

const leadFields = {
  name: z.string({ error: "Nome é obrigatório." }).trim().min(1, "Nome é obrigatório.").max(200, "Nome deve ter no máximo 200 caracteres."),
  company: optText("Empresa", 200),
  email: emailField,
  phone: phoneField,
  website: urlField("Site"),
  linkedin: urlField("LinkedIn"),
  source: optText("Origem", 100),
};

export const createLeadSchema = z.object({
  campaignId: z.uuid("Campanha inválida."),
  ...leadFields,
}).refine((d) => !!d.email || !!d.phone, { message: MIN_CONTACT_MSG, path: ["email"] });
export type CreateLeadInput = z.input<typeof createLeadSchema>;

/** Campanha não muda (D6: lead em 1 campanha). Campos ausentes = inalterados; null/"" = limpar. */
export const updateLeadSchema = z.object({
  leadId: z.uuid("Lead inválido."),
  ...leadFields,
  name: leadFields.name.optional(),
});
export type UpdateLeadInput = z.input<typeof updateLeadSchema>;

export const leadIdSchema = z.uuid("Lead inválido.");

export function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

const tagField = z
  .string({ error: "Tag inválida." })
  .transform(normalizeTag)
  .pipe(
    z
      .string()
      .min(1, "Tag não pode ser vazia.")
      .max(MAX_TAG_LENGTH, `Tag deve ter no máximo ${MAX_TAG_LENGTH} caracteres.`),
  );

export const tagSchema = z.object({ leadId: z.uuid("Lead inválido."), tag: tagField });
export const noteSchema = z.object({
  leadId: z.uuid("Lead inválido."),
  body: z.string({ error: "Nota inválida." }).trim().min(1, "Nota não pode ser vazia.").max(5000, "Nota deve ter no máximo 5000 caracteres."),
});
export const deleteNoteSchema = z.object({ noteId: z.uuid("Nota inválida.") });

export const moveLeadStageSchema = z.object({
  leadId: z.uuid("Lead inválido."),
  toStage: z.enum(STAGES, { error: "Etapa inválida." }),
  lostReason: z
    .string()
    .trim()
    .max(500, "Motivo deve ter no máximo 500 caracteres.")
    .nullable()
    .optional()
    .transform((v) => (v && v.length ? v : null)),
});

export const LEAD_SORTS = ["score", "name", "createdAt"] as const;

export const leadListParamsSchema = z.object({
  campaignId: z.uuid().optional().catch(undefined),
  stage: z.enum(STAGES).optional().catch(undefined),
  channel: z.enum(CHANNELS).optional().catch(undefined),
  scoreMin: z.coerce.number().min(0).optional().catch(undefined),
  scoreMax: z.coerce.number().min(0).optional().catch(undefined),
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .catch(undefined)
    .transform((v) => (v ? v : undefined)),
  sort: z.enum(LEAD_SORTS).default("createdAt").catch("createdAt"),
  dir: z.enum(["asc", "desc"]).default("desc").catch("desc"),
  page: z.coerce.number().int().min(1).default(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20).catch(20),
});
export type LeadListParams = z.input<typeof leadListParamsSchema>;
