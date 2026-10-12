import { z } from "zod";

/** SPEC-064 (D-064-1): regra UNICA de senha nova (cadastro, convite, redefinir). O LOGIN nao usa isso (nao ganha minimo). */
export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 256;
export const PASSWORD_MIN_MESSAGE = `Senha deve ter ao menos ${PASSWORD_MIN_LENGTH} caracteres.`;
export const PASSWORD_MISMATCH_MESSAGE = "As senhas não coincidem.";

export const newPasswordRule = z
  .string({ error: "Senha é obrigatória." })
  .min(PASSWORD_MIN_LENGTH, PASSWORD_MIN_MESSAGE)
  .max(PASSWORD_MAX_LENGTH, "Senha muito longa.");

/** Campo de confirmacao: so validado contra `password` (nunca persistido nem logado). */
export const confirmPasswordRule = z
  .string({ error: "Confirme a senha." })
  .min(1, "Confirme a senha.")
  .max(PASSWORD_MAX_LENGTH, "Senha muito longa.");

/** Aplica ao schema de objeto a checagem `password === confirmPassword` com o erro no campo `confirmPassword`. */
export function withPasswordConfirmation<S extends z.ZodType<{ password: string; confirmPassword: string }>>(schema: S) {
  return schema.refine((d) => d.password === d.confirmPassword, { message: PASSWORD_MISMATCH_MESSAGE, path: ["confirmPassword"] });
}
