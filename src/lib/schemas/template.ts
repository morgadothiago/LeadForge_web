import { z } from "zod";
import { validateSpintax } from "@/lib/templates/spintax";
import { extractVariables, TEMPLATE_VARIABLES } from "@/lib/templates/render";

export const channelSchema = z.enum(["email", "whatsapp", "linkedin", "phone"], { error: "Canal inválido." });

const varsCheck = (text: string, ctx: z.RefinementCtx, path: string) => {
  const allowed: readonly string[] = TEMPLATE_VARIABLES;
  const unknown = extractVariables(text).filter((v) => !allowed.includes(v));
  if (unknown.length) {
    ctx.addIssue({
      code: "custom",
      path: [path],
      message: `Variável desconhecida: ${unknown.map((u) => `{{${u}}}`).join(", ")}. Permitidas: ${TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(", ")}.`,
    });
  }
};

const templateFields = z.object({
  campaignId: z.uuid("Campanha inválida."),
  channel: channelSchema,
  name: z
    .string({ error: "Nome do template é obrigatório." })
    .trim()
    .min(1, "Nome do template é obrigatório.")
    .max(120, "Nome do template deve ter no máximo 120 caracteres."),
  subject: z
    .string()
    .trim()
    .max(200, "Assunto deve ter no máximo 200 caracteres.")
    .nullish()
    .transform((v) => (v ? v : null)),
  body: z
    .string({ error: "Mensagem é obrigatória." })
    .trim()
    .min(1, "Mensagem é obrigatória.")
    .max(5000, "Mensagem deve ter no máximo 5000 caracteres."),
});

function refine<T extends z.infer<typeof templateFields>>(v: T, ctx: z.RefinementCtx) {
  varsCheck(v.body, ctx, "body");
  if (v.subject) varsCheck(v.subject, ctx, "subject");
  if (v.channel === "whatsapp") {
    const spin = validateSpintax(v.body);
    if (spin) ctx.addIssue({ code: "custom", path: ["body"], message: spin });
  }
  if (v.channel === "email" && !v.subject) {
    ctx.addIssue({ code: "custom", path: ["subject"], message: "Assunto é obrigatório para e-mail." });
  }
  if (v.channel !== "email" && v.subject) {
    ctx.addIssue({ code: "custom", path: ["subject"], message: "Assunto só é permitido para e-mail." });
  }
}

export const templateCreateSchema = templateFields.superRefine(refine);
export type TemplateCreateInput = z.input<typeof templateCreateSchema>;

export const templateUpdateSchema = templateFields
  .extend({ id: z.uuid("ID do template inválido.") })
  .superRefine(refine);
export type TemplateUpdateInput = z.input<typeof templateUpdateSchema>;
