import { z } from "zod";
import { INTEGRATIONS, REQUIRES_BASE_URL } from "@/lib/integrations/types";

/** 12: chaves reais (Evolution, LLM, Places) têm 20+ caracteres; abaixo disso é quase certamente engano. */
export const SECRET_MIN = 12;
export const SECRET_MAX = 512;

const integration = z.enum(INTEGRATIONS, { error: "Integração inválida." });
const name = z.string({ error: "Nome inválido." }).trim().min(1, "Informe o nome.").max(40, "Nome deve ter no máximo 40 caracteres.")
  .regex(/^[a-z0-9_-]+$/, "Use apenas letras minúsculas, números, hífen e underline.");
const value = z.string({ error: "Chave inválida." }).trim().min(SECRET_MIN, `A chave deve ter ao menos ${SECRET_MIN} caracteres.`)
  .max(SECRET_MAX, `A chave deve ter no máximo ${SECRET_MAX} caracteres.`)
  .refine((v) => !/[\s\u0000-\u001f\u007f]/.test(v), "A chave não pode conter espaços ou quebras de linha.");
const baseUrl = z.string({ error: "URL inválida." }).trim().max(300, "URL muito longa.");

/** `value` vazio/ausente em edição mantém a chave atual (a exigência na criação é checada na action). */
export const saveIntegrationSchema = z.object({
  integration,
  name: name.default("default"),
  value: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), value.optional()),
  baseUrl: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), baseUrl.optional()),
  allowPrivateHost: z.boolean({ error: "Confirmação inválida." }).optional(),
}).superRefine((d, ctx) => {
  if (REQUIRES_BASE_URL[d.integration] && !d.baseUrl) ctx.addIssue({ code: "custom", path: ["baseUrl"], message: "Informe a URL." });
  if (d.integration === "evolution" && d.name !== "default") ctx.addIssue({ code: "custom", path: ["name"], message: "A Evolution usa uma única chave global (nome \"default\")." });
});

export const removeIntegrationSchema = z.object({
  id: z.uuid("Integração inválida."),
  confirm: z.literal(true, { error: "Confirme a remoção." }),
});
export const integrationIdSchema = z.uuid("Integração inválida.");
export const auditQuerySchema = z.object({
  integration: integration.optional(),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
}).default({ page: 1 });

/**
 * Dica exibida ("••••" + hint). Nunca revela mais que ~25% da chave: >=16 chars -> 4 últimos; 8-15 -> 2 últimos; <8 -> nada.
 */
export function secretHint(value: string): string {
  if (value.length >= 16) return value.slice(-4);
  if (value.length >= 8) return value.slice(-2);
  return "";
}
