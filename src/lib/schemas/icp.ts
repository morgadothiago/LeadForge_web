import { z } from "zod";

const text = (label: string, max: number) =>
  z
    .string({ error: `${label} é obrigatório.` })
    .trim()
    .min(1, `${label} é obrigatório.`)
    .max(max, `${label} deve ter no máximo ${max} caracteres.`);

const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} deve ter no máximo ${max} caracteres.`)
    .nullish()
    .transform((v) => (v ? v : null));

const list = (label: string) =>
  z
    .array(z.string().trim().min(1, `${label}: item vazio não é permitido.`).max(120, `${label}: item muito longo.`), {
      error: `${label} deve ser uma lista.`,
    })
    .max(30, `${label} aceita no máximo 30 itens.`)
    .default([])
    .transform((arr) => [...new Set(arr)]);

export const icpInputSchema = z.object({
  name: text("Nome do ICP", 100),
  niche: text("Nicho", 100),
  location: optionalText("Local", 120),
  companySize: optionalText("Porte", 60),
  signals: list("Sinais"),
  keywords: list("Palavras-chave"),
  sources: list("Fontes"),
  desiredData: list("Dados desejados"),
});
export type IcpInput = z.input<typeof icpInputSchema>;
export type IcpData = z.output<typeof icpInputSchema>;

export const icpUpdateSchema = icpInputSchema.extend({
  id: z.uuid("ID do ICP inválido."),
});
