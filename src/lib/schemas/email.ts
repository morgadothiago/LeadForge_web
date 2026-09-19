import { z } from "zod";

/** Rejeita CR/LF/U+2028/U+2029 (header injection). */
const NO_LINE_BREAK = /^[^\r\n\u2028\u2029]*$/;
const LB_MSG = "Não use quebras de linha.";

const host = z.string({ error: "Informe o host." }).trim().min(1, "Informe o host.").max(255, "Host muito longo.")
  .regex(NO_LINE_BREAK, LB_MSG)
  .regex(/^[A-Za-z0-9.-]+$/, "Host inválido.");
const port = z.coerce.number({ error: "Porta inválida." }).int("Porta inválida.").min(1, "Porta deve ser de 1 a 65535.").max(65535, "Porta deve ser de 1 a 65535.");
const email = z.string({ error: "Informe o e-mail." }).regex(NO_LINE_BREAK, LB_MSG).trim().toLowerCase().pipe(z.email("E-mail inválido."));
const password = z.string({ error: "Informe a senha." }).min(1, "Informe a senha.").max(512, "Senha muito longa.");
const dailyLimit = z.coerce.number({ error: "Limite diário inválido." }).int("Limite diário inválido.").min(1, "Limite diário mínimo é 1.").max(2000, "Limite diário máximo é 2000.");

const base = {
  provider: z.string({ error: "Informe o provedor." }).regex(NO_LINE_BREAK, LB_MSG).trim().min(1, "Informe o provedor.").max(60, "Provedor muito longo."),
  smtpHost: host,
  imapHost: z.string().max(255).regex(NO_LINE_BREAK, LB_MSG).trim().regex(/^[A-Za-z0-9.-]*$/, "Host inválido.").optional().transform((v) => v || undefined),
  port,
  email,
  fromName: z.string().regex(NO_LINE_BREAK, LB_MSG).trim().max(120, "Nome muito longo.").optional().transform((v) => v || undefined),
  dailyLimit: dailyLimit.default(50),
};

export const emailAccountCreateSchema = z.object({ ...base, password });
export const emailAccountUpdateSchema = z.object({
  id: z.uuid("Conta inválida."),
  ...base,
  /** Só envia para trocar a senha; ausente/vazia mantém a atual. */
  password: z.string().max(512, "Senha muito longa.").optional().transform((v) => v || undefined),
});
export const emailAccountIdSchema = z.uuid("Conta inválida.");
export const setActiveSchema = z.object({ id: z.uuid("Conta inválida."), isActive: z.boolean({ error: "Valor inválido." }) });
