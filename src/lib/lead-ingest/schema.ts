import { z } from "zod";
import { normalizeBrPhone } from "@/lib/domain/phone";
import { isSeedSource } from "@/lib/domain/seed-guard";
import { MAX_TAGS, MAX_TAG_LENGTH, normalizeTag } from "@/lib/schemas/lead";
import { MAX_LEADS_PER_CALL } from "./config";

/** Envelope: erros aqui => 400 (payload inteiro inválido). Itens são validados um a um (um inválido não derruba os outros). */
export const envelopeSchema = z.object(
  {
    campaignId: z.uuid("Campanha inválida."),
    leads: z
      .array(z.unknown(), { error: "O campo leads deve ser uma lista." })
      .min(1, "Envie ao menos 1 lead.")
      .max(MAX_LEADS_PER_CALL, `Envie no máximo ${MAX_LEADS_PER_CALL} leads por chamada.`),
  },
  { error: "Corpo inválido: envie um objeto JSON com campaignId e leads." },
);

const BAD_CHARS = /[\x00-\x1f\x7f\u2028\u2029]/;
const noControl = (label: string) => `${label} contém caracteres de controle inválidos.`;

const text = (label: string, max: number) =>
  z
    .string({ error: `${label} inválido.` })
    .trim()
    .max(max, `${label} deve ter no máximo ${max} caracteres.`)
    .refine((v) => !BAD_CHARS.test(v), noControl(label))
    .nullish()
    .transform((v) => (v ? v : null));

const url = (label: string) =>
  text(label, 300).refine((v) => v == null || /^https?:\/\/\S+$/i.test(v), `${label} inválido. Use um endereço começando com http:// ou https://.`);

export const MIN_CONTACT = "Informe ao menos um contato válido: e-mail ou telefone.";

export const itemSchema = z
  .object(
    {
      name: z.string({ error: "Nome é obrigatório." }).trim().min(1, "Nome é obrigatório.").max(200, "Nome deve ter no máximo 200 caracteres.").refine((v) => !BAD_CHARS.test(v), noControl("Nome")),
      company: text("Empresa", 200),
      email: z
        .string({ error: "E-mail inválido." })
        .trim()
        .toLowerCase()
        .max(254, "E-mail deve ter no máximo 254 caracteres.")
        .nullish()
        .transform((v) => (v ? v : null))
        .refine((v) => v == null || z.email().safeParse(v).success, "E-mail inválido."),
      phone: z
        .string({ error: "Telefone inválido." })
        .trim()
        .max(30, "Telefone deve ter no máximo 30 caracteres.")
        .nullish()
        .transform((v, ctx): string | null => {
          if (!v) return null;
          const r = normalizeBrPhone(v);
          if (!r.ok) {
            ctx.addIssue({ code: "custom", message: r.error });
            return z.NEVER;
          }
          return r.e164;
        }),
      website: url("Site"),
      linkedin: url("LinkedIn"),
      source: text("Origem", 100).refine((v) => v == null || !isSeedSource(v.toLowerCase()), "A origem \"seed\" não é permitida na ingestão."),
      tags: z
        .array(z.string({ error: "Tag inválida." }).transform(normalizeTag).pipe(z.string().min(1, "Tag não pode ser vazia.").max(MAX_TAG_LENGTH, `Tag deve ter no máximo ${MAX_TAG_LENGTH} caracteres.`)), { error: "Tags inválidas." })
        .max(MAX_TAGS, `No máximo ${MAX_TAGS} tags por lead.`)
        .nullish()
        .transform((v) => [...new Set(v ?? [])]),
      externalId: text("externalId", 100),
    },
    { error: "Item inválido: esperado um objeto." },
  )
  .refine((d) => !!d.email || !!d.phone, { message: MIN_CONTACT, path: ["email"] });

export type IngestItem = z.output<typeof itemSchema>;

/** Motivo PT-BR sem eco do valor recebido (mensagens são fixas). */
export function reasonFrom(err: z.ZodError): string {
  return [...new Set(err.issues.map((i) => i.message))].slice(0, 3).join(" ");
}
