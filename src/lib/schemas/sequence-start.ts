import { z } from "zod";

export const startSequenceSchema = z.object({ leadId: z.uuid("Lead inválido.") });
export const stopSequenceSchema = z.object({ leadId: z.uuid("Lead inválido.") });
export const startCampaignSequencesSchema = z.object({
  campaignId: z.uuid("Campanha inválida."),
  /** Confirmação explícita: inicia envios reais para TODOS os leads elegíveis. */
  confirm: z.literal(true, { error: "Confirme o início dos envios da campanha." }),
});
export const campaignIdSchema = z.uuid("Campanha inválida.");
