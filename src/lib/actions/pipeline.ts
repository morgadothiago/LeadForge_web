"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { runMoveOpportunity, type MoveResult } from "@/lib/domain/move-opportunity";
import {
  moveOpportunitySchema,
  updateOpportunitySchema,
} from "@/lib/schemas/pipeline";
import {
  failure,
  formError,
  safeAction,
  success,
  zodErrors,
  type ActionResult,
} from "./result";

function revalidate(): void {
  revalidatePath("/pipeline");
  revalidatePath("/");
}

export type { MoveResult } from "@/lib/domain/move-opportunity";

/**
 * Move card (stage livre, D11). Numa única $transaction Serializable: recalcula a coluna
 * destino (e origem, se diferente) com posições 0..n-1 sem lacunas/duplicatas e registra StageHistory.
 * toIndex acima do tamanho é limitado ao fim. No-op (sem escrita/revalidação) se nada muda.
 */
export async function moveOpportunity(
  input: unknown,
): Promise<ActionResult<MoveResult>> {
  return safeAction(async () => {
    await requireUser();
    const parsed = moveOpportunitySchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { opportunityId, toStage, toIndex, campaignId, lostReason } = parsed.data;

    const outcome = await runMoveOpportunity({ opportunityId, toStage, toIndex, campaignId, lostReason });
    if (outcome.status === "conflict") {
      return formError("O quadro foi alterado por outra ação. Recarregue e tente novamente.");
    }
    if (outcome.status === "not_found")
      return formError(
        "Oportunidade não encontrada. Ela pode ter sido movida ou excluída.",
      );
    const result = outcome.result;
    if (result.changed) revalidate();
    return success(result);
  });
}

export async function updateOpportunity(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    await requireUser();
    const parsed = updateOpportunitySchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { opportunityId, value, notes } = parsed.data;
    const data: Prisma.OpportunityUpdateInput = {};
    if (value !== undefined) data.value = value;
    if (notes !== undefined) data.notes = notes;
    const updated = await prisma.opportunity.update({
      where: { id: opportunityId },
      data,
      select: { id: true },
    });
    revalidate();
    return success({ id: updated.id });
  });
}
