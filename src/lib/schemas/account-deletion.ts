import { z } from "zod";

/** SPEC-054a: schemas das actions de exclusao de conta (LGPD). Reutilizaveis pelo frontend (RHF, 054b). */
const token = z.string({ error: "Token é obrigatório." }).trim().min(1, "Token é obrigatório.").max(512, "Token inválido.");

export const requestAccountDeletionSchema = z.object({
  password: z.string({ error: "Senha é obrigatória." }).min(1, "Senha é obrigatória.").max(256, "Senha muito longa."),
});
export type RequestAccountDeletionInput = z.input<typeof requestAccountDeletionSchema>;

export const accountDeletionTokenSchema = z.object({ token });
export type AccountDeletionTokenInput = z.input<typeof accountDeletionTokenSchema>;

export const cancelAccountDeletionWithPasswordSchema = z.object({
  email: z.string({ error: "E-mail é obrigatório." }).trim().toLowerCase().min(1, "E-mail é obrigatório.").email("E-mail inválido."),
  password: z.string({ error: "Senha é obrigatória." }).min(1, "Senha é obrigatória.").max(256, "Senha muito longa."),
});
export type CancelAccountDeletionWithPasswordInput = z.input<typeof cancelAccountDeletionWithPasswordSchema>;
