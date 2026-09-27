import { z } from "zod";

export const MEETING_MIN_DURATION = 5;
export const MEETING_MAX_DURATION = 480;
export const MEETING_NOTES_MAX = 2000;
export const MEETING_MAX_RANGE_DAYS = 62;
export const REMINDER_OFFSETS = [1440, 120, 60, 30, 15, 5] as const;
export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+$|^UTC$/.test(tz);
  } catch {
    return false;
  }
}

/** ISO 8601 com offset explicito ou Z (nunca horario "solto"). Devolve Date (UTC). */
export const isoInstant = (label = "Data") =>
  z
    .string({ error: `${label} inválida.` })
    .trim()
    .refine((v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(v) && !Number.isNaN(Date.parse(v)), `${label} inválida: use ISO 8601 com fuso (ex.: 2026-10-01T14:00:00-03:00).`)
    .transform((v) => new Date(v));

const httpsLink = z
  .string({ error: "Link inválido." })
  .trim()
  .max(500, "Link deve ter no máximo 500 caracteres.")
  .refine((v) => /^https:\/\/[^\s]+$/.test(v) && URL.canParse(v), "Link deve começar com https://.");

const optLink = httpsLink.or(z.literal("")).nullable().optional().transform((v) => (v ? v : v === undefined ? undefined : null));
const optNotes = z
  .string({ error: "Observações inválidas." })
  .trim()
  .max(MEETING_NOTES_MAX, `Observações devem ter no máximo ${MEETING_NOTES_MAX} caracteres.`)
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v ? v : null));
const duration = z
  .number({ error: "Duração inválida." })
  .int("Duração inválida.")
  .min(MEETING_MIN_DURATION, `Duração mínima: ${MEETING_MIN_DURATION} minutos.`)
  .max(MEETING_MAX_DURATION, `Duração máxima: ${MEETING_MAX_DURATION} minutos.`);
const tz = z.string().trim().refine(isValidTimezone, "Fuso horário inválido.");
const clientRequestId = z.string().trim().regex(/^[A-Za-z0-9_-]{8,100}$/, "Identificador de requisição inválido.").optional();

export const createMeetingSchema = z.object({
  opportunityId: z.uuid("Oportunidade inválida."),
  startsAt: isoInstant("Início"),
  durationMin: duration.default(30),
  timezone: tz.default(DEFAULT_TIMEZONE),
  link: optLink,
  notes: optNotes,
  clientRequestId,
});
export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;

export const updateMeetingSchema = z.object({
  id: z.uuid("Reunião inválida."),
  startsAt: isoInstant("Início").optional(),
  durationMin: duration.optional(),
  timezone: tz.optional(),
  link: optLink,
  notes: optNotes,
});
export type UpdateMeetingInput = z.infer<typeof updateMeetingSchema>;

export const meetingIdSchema = z.object({ id: z.uuid("Reunião inválida.") });

export const meetingRangeSchema = z.object({
  from: isoInstant("Início do intervalo"),
  to: isoInstant("Fim do intervalo"),
});

export const meetingSettingsSchema = z.object({
  remindersEnabled: z.boolean({ error: "Valor inválido." }),
  offsetsMin: z
    .array(z.number().int().refine((n) => (REMINDER_OFFSETS as readonly number[]).includes(n), "Antecedência inválida."))
    .max(REMINDER_OFFSETS.length, "Antecedências demais.")
    .transform((a) => [...new Set(a)].sort((x, y) => y - x)),
});

/**
 * Webhook (SPEC-028 item 4). Estrito: campo desconhecido = 400.
 * SPEC-030 (fix de vazamento cross-tenant, 2026-09-26): `campaignId` passou a ser SEMPRE obrigatório, mesmo
 * quando `leadId` é informado — mesmo padrão de `/api/integrations/leads` (SPEC-014), onde `campaignId`
 * explícito é quem resolve a organização antes de qualquer efeito. Sem isso, um `leadId` (UUID) adivinhado
 * de outro tenant não tinha como ser rejeitado (o segredo de ingestão é global, não por org) — exigir
 * `campaignId` sempre, e não só "quando leadId não é enviado", fecha os dois caminhos (leadId e phone) com
 * a mesma regra, em vez de manter dois comportamentos de segurança diferentes no mesmo endpoint. É uma
 * quebra de contrato deliberada (aprovada pelo usuário): quem chamava este webhook sem `campaignId` passa a
 * receber 400 `validation_error`.
 */
export const meetingWebhookSchema = z
  .object({
    campaignId: z.uuid("campaignId inválido."),
    leadId: z.uuid("leadId inválido.").optional(),
    phone: z.string().trim().min(8).max(32).optional(),
    startsAt: isoInstant("startsAt"),
    durationMin: duration.optional(),
    link: optLink,
    externalId: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,128}$/, "externalId inválido.").optional(),
  })
  .strict()
  .refine((v) => !!v.leadId !== !!v.phone, "Informe leadId ou phone (apenas um).");
export type MeetingWebhookInput = z.infer<typeof meetingWebhookSchema>;

export const leadSearchSchema = z.object({ q: z.string().trim().min(2, "Digite ao menos 2 caracteres.").max(80) });
