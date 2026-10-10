import { z } from "zod";
import { CREATIVE_ASPECT_RATIOS, CREATIVE_LANGUAGES, CREATIVE_STATUSES } from "@/lib/creatives/types";

/**
 * SPEC-051 — schemas das actions de criativos. Limites de tamanho do roteiro/duracao sao revalidados no servidor
 * contra `CREATIVE_MAX_*` (config), pois variam por env; aqui ficam so os tetos estruturais.
 */
const id = z.string({ error: "Identificador inválido." }).trim().min(1, "Identificador inválido.").max(64, "Identificador inválido.");

export const createCreativeDraftSchema = z.object({
  title: z.string({ error: "Título é obrigatório." }).trim().min(1, "Título é obrigatório.").max(120, "Título muito longo (máx. 120)."),
  script: z.string({ error: "Roteiro é obrigatório." }).trim().min(1, "Roteiro é obrigatório.").max(20_000, "Roteiro muito longo."),
  language: z.enum(CREATIVE_LANGUAGES, { error: "Idioma inválido." }),
  avatarRef: z.string({ error: "Escolha um avatar." }).trim().min(1, "Escolha um avatar.").max(120),
  voiceRef: z.string({ error: "Escolha uma voz." }).trim().min(1, "Escolha uma voz.").max(120),
  aspectRatio: z.enum(CREATIVE_ASPECT_RATIOS, { error: "Formato inválido." }),
  /** Duracao maxima desejada (s); omitida => estimada do roteiro. */
  durationSec: z.number({ error: "Duração inválida." }).int("Duração inválida.").min(1, "Duração inválida.").max(3600, "Duração inválida.").optional(),
});
export type CreateCreativeDraftInput = z.input<typeof createCreativeDraftSchema>;

export const creativeIdSchema = z.object({ id });

export const listCreativesSchema = z.object({
  status: z.enum(CREATIVE_STATUSES, { error: "Status inválido." }).optional(),
  q: z.string().trim().max(120).optional(),
  cursor: z.string().trim().min(1).max(64).nullish(),
  limit: z.number().int().min(1).max(50).optional(),
});
export type ListCreativesInput = z.input<typeof listCreativesSchema>;
