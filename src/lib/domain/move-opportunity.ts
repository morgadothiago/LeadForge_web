import { Prisma, type Stage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordStageChange } from "./stage-history";

export interface MoveResult {
  id: string;
  stage: Stage;
  position: number;
  changed: boolean;
}

/**
 * Encerra a sequência automática do lead (fechado/perdido). Idempotente:
 * `completed` + nextTouchAt null; Touches pending/scheduled viram `skipped`
 * (TouchStatus não tem `cancelled`). Não toca repliedAt/optedOutAt; leads
 * opted_out mantêm o status. Reabrir o card NÃO reativa a sequência.
 */
async function endSequence(
  tx: Prisma.TransactionClient,
  leadId: string,
): Promise<void> {
  await tx.lead.updateMany({
    where: { id: leadId, sequenceStatus: { not: "opted_out" } },
    data: { sequenceStatus: "completed", nextTouchAt: null },
  });
  await tx.lead.updateMany({
    where: { id: leadId, nextTouchAt: { not: null } },
    data: { nextTouchAt: null },
  });
  await tx.touch.updateMany({
    where: { leadId, status: { in: ["pending", "scheduled"] } },
    data: { status: "skipped" },
  });
}

/** Mesma ordenação do board. */
const ORDER = [
  { position: "asc" },
  { createdAt: "asc" },
  { id: "asc" },
] as const;


export interface MoveParams {
  opportunityId: string;
  toStage: Stage;
  toIndex: number;
  campaignId?: string;
  lostReason?: string | null;
}

export type MoveOutcome =
  | { status: "ok"; result: MoveResult }
  | { status: "not_found" }
  | { status: "conflict" };

/**
 * Núcleo transacional (Serializable) do move de oportunidade, compartilhado por
 * `moveOpportunity` (pipeline) e `moveLeadStage` (leads). Sem auth/revalidate: quem chama cuida.
 */
export async function runMoveOpportunity(params: MoveParams): Promise<MoveOutcome> {
  const { opportunityId, toStage, toIndex, campaignId, lostReason } = params;
    let result: MoveResult | null;
    try {
      result = await prisma.$transaction(
        async (tx): Promise<MoveResult | null> => {
          const opp = await tx.opportunity.findUnique({
            where: { id: opportunityId },
            select: {
              id: true,
              stage: true,
              position: true,
              campaignId: true,
              leadId: true,
              lostReason: true,
            },
          });
          if (!opp) return null;
          if (campaignId && opp.campaignId !== campaignId) return null;
          const scope: Prisma.OpportunityWhereInput = campaignId
            ? { campaignId }
            : {};

          const dest = await tx.opportunity.findMany({
            where: { ...scope, stage: toStage, id: { not: opp.id } },
            orderBy: [...ORDER],
            select: { id: true, position: true },
          });
          const idx = Math.min(toIndex, dest.length);
          const ordered = [
            ...dest.slice(0, idx),
            { id: opp.id, position: opp.position },
            ...dest.slice(idx),
          ];

          const sameStage = opp.stage === toStage;
          if (sameStage) {
            const current = await tx.opportunity.findMany({
              where: { ...scope, stage: toStage },
              orderBy: [...ORDER],
              select: { id: true, position: true },
            });
            const unchanged =
              current.length === ordered.length &&
              current.every(
                (c, i) => c.id === ordered[i].id && c.position === i,
              );
            if (unchanged) {
              // Mesma coluna/posição: só atualiza o motivo se perdido e mudou.
              if (toStage === "perdido" && lostReason !== opp.lostReason) {
                await tx.opportunity.update({
                  where: { id: opp.id },
                  data: { lostReason },
                });
                return {
                  id: opp.id,
                  stage: toStage,
                  position: idx,
                  changed: true,
                };
              }
              return {
                id: opp.id,
                stage: toStage,
                position: idx,
                changed: false,
              };
            }
          }

          for (let i = 0; i < ordered.length; i++) {
            const o = ordered[i];
            if (o.id === opp.id) {
              await tx.opportunity.update({
                where: { id: o.id },
                data: {
                  stage: toStage,
                  position: i,
                  lostReason: toStage === "perdido" ? lostReason : null,
                },
              });
            } else if (o.position !== i) {
              await tx.opportunity.updateMany({
                where: { id: o.id },
                data: { position: i },
              });
            }
          }
          if (!sameStage) {
            const src = await tx.opportunity.findMany({
              where: { ...scope, stage: opp.stage },
              orderBy: [...ORDER],
              select: { id: true, position: true },
            });
            for (let i = 0; i < src.length; i++) {
              if (src[i].position !== i) {
                await tx.opportunity.update({
                  where: { id: src[i].id },
                  data: { position: i },
                });
              }
            }
            await recordStageChange(tx, opp.id, opp.stage, toStage);
            if (toStage === "fechado" || toStage === "perdido") {
              await endSequence(tx, opp.leadId);
            }
          }
          return { id: opp.id, stage: toStage, position: idx, changed: true };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
        return { status: "conflict" };
      }
      throw e;
    }
    return result ? { status: "ok", result } : { status: "not_found" };
}
