import { z } from "zod";
import { SECRET_MAX, SECRET_MIN } from "@/lib/schemas/integration";

/**
 * SPEC-041 (D-041-4) — schemas dos vínculos `LeadSourceBinding` (Google Ads Lead Form / Meta Lead Ads).
 *
 * `externalAccountId` usa o MESMO charset do `GOOGLE_KEY_RE` do webhook
 * (`src/lib/lead-source/google-ads-handler.ts`): o handler rejeita o payload inteiro quando o
 * identificador não casa, então a régua precisa ser idêntica — se o painel aceitar o que o webhook
 * recusa, o vínculo fica salvo e o lead nunca chega.
 */
export const PROVIDERS = ["google_ads", "meta"] as const;
export type LeadSourceProviderName = (typeof PROVIDERS)[number];

const externalAccountId = z
  .string({ error: "Identificador inválido." })
  .trim()
  .min(1, "Informe o identificador.")
  .max(200, "Identificador deve ter no máximo 200 caracteres.")
  .regex(/^[A-Za-z0-9._:-]+$/, "Use apenas letras, números, ponto, hífen, sublinhado e dois-pontos.");

const label = z.string({ error: "Rótulo inválido." }).trim().max(80, "Rótulo deve ter no máximo 80 caracteres.");

const pageToken = z
  .string({ error: "Token inválido." })
  .trim()
  .min(SECRET_MIN, `O Page Access Token deve ter ao menos ${SECRET_MIN} caracteres.`)
  .max(SECRET_MAX, `O Page Access Token deve ter no máximo ${SECRET_MAX} caracteres.`)
  .refine((v) => !/[\s\u0000-\u001f\u007f]/.test(v), "O token não pode conter espaços ou quebras de linha.");

const emptyToUndefined = (v: unknown): unknown => (typeof v === "string" && v.trim() === "" ? undefined : v);

/**
 * `pageToken` vazio/ausente em edição mantém o token atual (a exigência na criação é checada na action);
 * `label` vazia apaga o rótulo. As duas exigências da criação (token do Meta, existência da campanha)
 * ficam na action para valer dentro da mesma transação do upsert.
 */
export const saveLeadSourceBindingSchema = z
  .object({
    provider: z.enum(PROVIDERS, { error: "Plataforma inválida." }),
    externalAccountId,
    label: z.preprocess(emptyToUndefined, label.optional()),
    campaignId: z.uuid("Selecione uma campanha."),
    pageToken: z.preprocess(emptyToUndefined, pageToken.optional()),
  })
  .superRefine((d, ctx) => {
    if (d.provider === "google_ads" && d.pageToken) {
      ctx.addIssue({ code: "custom", path: ["pageToken"], message: "O Google Ads não usa Page Access Token." });
    }
    // `metaPageTokenName()` monta o nome do segredo como `page:<id>` cortado em 40 chars: um id acima de
    // 32 ("page:" = 5) poderia colidir com outra Página ao truncar, trocando o token entre vinculos.
    if (d.provider === "meta" && d.externalAccountId.length > 32) {
      ctx.addIssue({ code: "custom", path: ["externalAccountId"], message: "O ID da Página do Meta deve ter no máximo 32 caracteres." });
    }
  });

export const removeLeadSourceBindingSchema = z.object({
  id: z.uuid("Vínculo inválido."),
  confirm: z.literal(true, { error: "Confirme a remoção." }),
});

/** Formulário: valores de ENTRADA (antes do preprocess/trim do zod). */
export type LeadSourceBindingInput = z.input<typeof saveLeadSourceBindingSchema>;
/** Formulário: valores validados (o que a action recebe). */
export type LeadSourceBindingValues = z.output<typeof saveLeadSourceBindingSchema>;
