import { z } from "zod";
import { normalizeBrPhone } from "@/lib/domain/phone";

const email = z.string().trim().toLowerCase().email("E-mail inválido.").max(200, "E-mail muito longo.");
const phone = z.string().trim().transform((v, ctx) => {
  const r = normalizeBrPhone(v);
  if (!r.ok) {
    ctx.addIssue({ code: "custom", message: r.error });
    return z.NEVER;
  }
  return r.e164;
});
const reasonText = z.string({ error: "Informe o motivo." }).trim().min(5, "Descreva o motivo (mínimo 5 caracteres).").max(300, "Motivo deve ter no máximo 300 caracteres.");

/** Motivos permitidos na inclusão manual. */
export const manualReasonSchema = z.enum(["opt_out_manual", "manual", "bounce"], { error: "Motivo inválido." });

export const addToSuppressionSchema = z
  .object({
    leadId: z.uuid("Lead inválido.").optional(),
    email: email.optional(),
    phone: phone.optional(),
    reason: manualReasonSchema.default("opt_out_manual"),
    note: z.string().trim().max(300, "Observação deve ter no máximo 300 caracteres.").optional(),
  })
  .refine((v) => v.leadId || v.email || v.phone, { message: "Informe um lead, e-mail ou telefone.", path: ["leadId"] });

export const removeFromSuppressionSchema = z.object({
  id: z.uuid("Registro inválido."),
  /** Registro do motivo da remoção (auditoria). */
  reason: reasonText,
  /** Confirmação explícita: remover libera novos envios a este contato. */
  confirm: z.literal(true, { error: "Confirme a remoção da lista de supressão." }),
});

export const suppressionListParamsSchema = z.object({
  kind: z.enum(["phone", "email"]).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type SuppressionListParams = z.input<typeof suppressionListParamsSchema>;

export const contactSchema = z.object({ email: z.string().trim().max(200).optional().nullable(), phone: z.string().trim().max(30).optional().nullable() });
