import type { Prisma, Stage } from "@prisma/client";

/**
 * Registra uma transição de stage. Chamar dentro da mesma transação que
 * atualiza Opportunity.stage (ex.: mover card no Kanban, SPEC-007).
 * Não registra nada quando from === to.
 */
export async function recordStageChange(
  tx: Pick<Prisma.TransactionClient, "stageHistory">,
  opportunityId: string,
  from: Stage | null,
  to: Stage,
  changedAt: Date = new Date(),
) {
  if (from === to) return null;
  return tx.stageHistory.create({
    data: { opportunityId, fromStage: from, toStage: to, changedAt },
  });
}
