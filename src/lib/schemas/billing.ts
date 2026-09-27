import { z } from "zod";

const cadenceSchema = z.enum(["monthly", "yearly"]);
const planKeySchema = z.string().trim().min(1, "Plano é obrigatório.").max(50);

export const checkoutSchema = z.object({
  planKey: planKeySchema,
  cadence: cadenceSchema,
});
export type CheckoutInput = z.input<typeof checkoutSchema>;

/** SPEC-033 (D-35-1/D-33-3): signup self-service — cria User+Organization+Membership(owner)+Subscription(trialing). Senha: mesma régua do ADMIN_PASSWORD (12+). */
export const signupSchema = z.object({
  name: z.string({ error: "Nome é obrigatório." }).trim().min(1, "Nome é obrigatório.").max(120),
  email: z.string({ error: "E-mail é obrigatório." }).trim().toLowerCase().min(1, "E-mail é obrigatório.").email("E-mail inválido."),
  password: z.string({ error: "Senha é obrigatória." }).min(12, "Senha deve ter ao menos 12 caracteres.").max(256, "Senha muito longa."),
  orgName: z.string({ error: "Nome da organização é obrigatório." }).trim().min(1, "Nome da organização é obrigatório.").max(120),
  planKey: planKeySchema,
});
export type SignupInput = z.input<typeof signupSchema>;
