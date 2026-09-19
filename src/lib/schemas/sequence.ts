import { z } from "zod";
import { channelSchema } from "./template";

export const sequenceNameSchema = z
  .string({ error: "Nome da sequência é obrigatório." })
  .trim()
  .min(1, "Nome da sequência é obrigatório.")
  .max(120, "Nome da sequência deve ter no máximo 120 caracteres.");

export const stepInputSchema = z.object({
  day: z
    .number({ error: "Dia é obrigatório." })
    .int("Dia deve ser um número inteiro.")
    .min(0, "Dia não pode ser negativo.")
    .max(365, "Dia deve ser no máximo 365."),
  channel: channelSchema,
  templateId: z.uuid("Template inválido."),
});
export type StepInput = z.infer<typeof stepInputSchema>;

/** Dias devem ser não decrescentes na ordem dos steps. */
export function nonDecreasingDays(steps: { day: number }[], ctx: z.RefinementCtx): void {
  for (let i = 1; i < steps.length; i++) {
    if (steps[i].day < steps[i - 1].day) {
      ctx.addIssue({
        code: "custom",
        path: ["steps", i, "day"],
        message: "O dia do passo não pode ser menor que o do passo anterior.",
      });
    }
  }
}

export const sequenceCreateSchema = z.object({
  name: sequenceNameSchema,
  steps: z.array(stepInputSchema).max(30, "Máximo de 30 passos.").default([]),
}).superRefine((v, ctx) => nonDecreasingDays(v.steps, ctx));
export type SequenceCreateInput = z.input<typeof sequenceCreateSchema>;

export const sequenceRenameSchema = z.object({ id: z.uuid("ID inválido."), name: sequenceNameSchema });

/** Substitui a lista de steps (ordem = índice). `id` presente preserva o step (e seus touches). */
export const sequenceStepsSchema = z
  .object({
    sequenceId: z.uuid("ID inválido."),
    steps: z.array(stepInputSchema.extend({ id: z.uuid("ID do passo inválido.").optional() })).max(30, "Máximo de 30 passos."),
  })
  .superRefine((v, ctx) => nonDecreasingDays(v.steps, ctx));
export type SequenceStepsInput = z.input<typeof sequenceStepsSchema>;

export const reorderSchema = z.object({
  sequenceId: z.uuid("ID inválido."),
  stepIds: z.array(z.uuid("ID do passo inválido.")).min(1, "Informe os passos."),
});
export type ReorderInput = z.input<typeof reorderSchema>;
