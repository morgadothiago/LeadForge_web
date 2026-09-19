import { z } from "zod";

export const loginSchema = z.object({
  email: z.string({ error: "E-mail é obrigatório." }).trim().toLowerCase().min(1, "E-mail é obrigatório.").email("E-mail inválido."),
  password: z.string({ error: "Senha é obrigatória." }).min(1, "Senha é obrigatória.").max(256, "Senha muito longa."),
  next: z.string().optional(),
});
export type LoginInput = z.input<typeof loginSchema>;
