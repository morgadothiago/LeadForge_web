import { z } from "zod";
import { normalizeBrPhone } from "@/lib/domain/phone";

const number = z.string({ error: "Informe o número." }).trim().min(1, "Informe o número.").max(30, "Número muito longo.")
  .transform((v, ctx) => {
    const r = normalizeBrPhone(v);
    if (!r.ok) {
      ctx.addIssue({ code: "custom", message: r.error });
      return z.NEVER;
    }
    return r.e164;
  });
const dailyLimit = z.coerce.number({ error: "Limite diário inválido." }).int("Limite diário inválido.").min(1, "Limite diário mínimo é 1.").max(200, "Limite diário máximo é 200.");

export const instanceNameSchema = z.string({ error: "Informe o nome da instância." }).trim()
  .min(3, "Nome deve ter ao menos 3 caracteres.").max(40, "Nome deve ter no máximo 40 caracteres.")
  .regex(/^[A-Za-z0-9_-]+$/, "Use apenas letras, números, hífen e underline.");

export const whatsappInstanceCreateSchema = z.object({ instanceName: instanceNameSchema, number, dailyLimit: dailyLimit.default(30) });
export const whatsappInstanceUpdateSchema = z.object({ id: z.uuid("Instância inválida."), number: number.optional(), dailyLimit });
export const whatsappInstanceIdSchema = z.uuid("Instância inválida.");
export const leadIdSchema = z.uuid("Lead inválido.");
