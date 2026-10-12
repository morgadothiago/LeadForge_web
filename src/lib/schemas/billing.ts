import { z } from "zod";
import { parseDocument } from "@/lib/domain/document";
import { confirmPasswordRule, newPasswordRule, withPasswordConfirmation } from "./password";

const cadenceSchema = z.enum(["monthly", "yearly"]);
const planKeySchema = z.string().trim().min(1, "Plano é obrigatório.").max(50);

export const checkoutSchema = z.object({
  planKey: planKeySchema,
  cadence: cadenceSchema,
});
export type CheckoutInput = z.input<typeof checkoutSchema>;

/**
 * SPEC-062 (D-062-1/7): cadastro SO com o usuario (nome, e-mail, senha 6+ e confirmacao, SPEC-064). `plan`/`cadence` sao a INTENCAO vinda da landing
 * (`/signup?plan=&cadence=`): opcionais e tolerantes — valor invalido vira `undefined` (nunca erro de cadastro); o servidor ainda
 * valida o plano contra os planos self-service ativos.
 */
export const signupSchema = withPasswordConfirmation(z.object({
  name: z.string({ error: "Nome é obrigatório." }).trim().min(1, "Nome é obrigatório.").max(120),
  email: z.string({ error: "E-mail é obrigatório." }).trim().toLowerCase().min(1, "E-mail é obrigatório.").email("E-mail inválido."),
  /** SPEC-065 (D-065-27): CPF ou CNPJ obrigatorio (mascara opcional); digitos verificadores + sequencia repetida validados aqui (cliente E servidor). So o hash e guardado. */
  document: z
    .string({ error: "CPF ou CNPJ é obrigatório." })
    .trim()
    .min(1, "CPF ou CNPJ é obrigatório.")
    .max(30, "CPF ou CNPJ inválido.")
    .refine((v) => parseDocument(v) !== null, "CPF ou CNPJ inválido."),
  password: newPasswordRule,
  confirmPassword: confirmPasswordRule,
  plan: planKeySchema.optional().catch(undefined),
  cadence: cadenceSchema.optional().catch(undefined),
}));
export type SignupInput = z.input<typeof signupSchema>;

/** SPEC-062 (D-062-13): nomear a organizacao ja paga (casca). */
export const completeOrgSetupSchema = z.object({
  name: z.string({ error: "Nome da organização é obrigatório." }).trim().min(1, "Nome da organização é obrigatório.").max(120),
});
export type CompleteOrgSetupInput = z.input<typeof completeOrgSetupSchema>;

/** SPEC-065 (D-065-22): renomear a organizacao (cartao "Como se chama a sua empresa?" e Configuracoes). */
export const renameOrgSchema = z.object({
  name: z.string({ error: "Nome da organização é obrigatório." }).trim().min(1, "Nome da organização é obrigatório.").max(120),
});
export type RenameOrgInput = z.input<typeof renameOrgSchema>;

/** SPEC-053b (D-053-6): confirmação explícita do cancelamento (checkbox no modal; sem senha). A action em si não recebe input. */
export const cancelConfirmSchema = z.object({
  confirm: z.boolean().refine((v) => v === true, { message: "Marque a caixa para confirmar o cancelamento." }),
});
export type CancelConfirmInput = z.input<typeof cancelConfirmSchema>;
