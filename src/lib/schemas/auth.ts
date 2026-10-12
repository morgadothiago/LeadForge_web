import { z } from "zod";
import { confirmPasswordRule, newPasswordRule, withPasswordConfirmation } from "./password";

export const loginSchema = z.object({
  email: z.string({ error: "E-mail é obrigatório." }).trim().toLowerCase().min(1, "E-mail é obrigatório.").email("E-mail inválido."),
  password: z.string({ error: "Senha é obrigatória." }).min(1, "Senha é obrigatória.").max(256, "Senha muito longa."),
  next: z.string().optional(),
});
export type LoginInput = z.input<typeof loginSchema>;

/** SPEC-038: "esqueci minha senha" — mesma normalização de e-mail do login/signup. */
export const forgotPasswordSchema = z.object({
  email: z.string({ error: "E-mail é obrigatório." }).trim().toLowerCase().min(1, "E-mail é obrigatório.").email("E-mail inválido."),
});
export type ForgotPasswordInput = z.input<typeof forgotPasswordSchema>;

/** SPEC-038: "redefinir senha" — senha com a MESMA régua do signup self-service (SPEC-034, 6+ caracteres + confirmacao, SPEC-064). */
export const resetPasswordSchema = withPasswordConfirmation(z.object({
  token: z.string({ error: "Token é obrigatório." }).trim().min(1, "Token é obrigatório.").max(512, "Token inválido."),
  password: newPasswordRule,
  confirmPassword: confirmPasswordRule,
}));
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;
