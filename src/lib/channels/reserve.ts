import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findSuppression, SUPPRESSED_MESSAGE } from "@/lib/domain/suppression";

/**
 * Marcador tipado: Touch `failed` cujo erro começa assim (timeout de envio WhatsApp: a mensagem PODE ter saído) NUNCA é reservado
 * automaticamente; só a action `retryTouch` (ação humana explícita com confirmação) o devolve para `scheduled`.
 */
export const NEEDS_REVIEW_PREFIX = "Não foi possível confirmar o envio";
export const REPLIED_MESSAGE = "lead respondeu/sequência encerrada";

/** Filtro de Touch reservável. `autoRetryFailed=false` exclui `failed` que exige revisão humana (marcador acima). */
export function reservableWhere(touchId: string, staleMs: number, autoRetryFailed = true): Prisma.TouchWhereInput {
  return {
    id: touchId,
    OR: [
      autoRetryFailed
        ? { status: "failed" }
        : { status: "failed", OR: [{ error: null }, { NOT: { error: { startsWith: NEEDS_REVIEW_PREFIX } } }] },
      { status: { in: ["pending", "scheduled"] } },
      { status: "sending", updatedAt: { lt: new Date(Date.now() - staleMs) } },
    ],
  };
}

/** SPEC-017: supressão consultada ANTES de reservar. Se suprimido, marca skipped direto (Touch nunca passa por `sending`). */
export async function skipSuppressedBeforeReserve(touchId: string, where: Prisma.TouchWhereInput): Promise<boolean> {
  const t = await prisma.touch.findUnique({ where: { id: touchId }, select: { lead: { select: { email: true, phone: true } } } });
  if (!t || !(await findSuppression(t.lead))) return false;
  const r = await prisma.touch.updateMany({ where, data: { status: "skipped", error: SUPPRESSED_MESSAGE } });
  return r.count > 0;
}

/** Lead respondeu depois da criação do Touch ou sequência encerrada/pausada por resposta/opt-out -> não enviar. */
export function repliedOrEnded(lead: { repliedAt: Date | null; sequenceStatus: string }, touchCreatedAt: Date): boolean {
  return (
    (lead.repliedAt !== null && lead.repliedAt.getTime() > touchCreatedAt.getTime()) ||
    lead.sequenceStatus === "paused_replied" || lead.sequenceStatus === "opted_out" || lead.sequenceStatus === "completed"
  );
}

/** Relê o lead do banco (não confia no snapshot do início do envio). */
export async function leadStopped(leadId: string, touchCreatedAt: Date): Promise<boolean> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { repliedAt: true, sequenceStatus: true, optedOutAt: true } });
  return !lead || lead.optedOutAt !== null || repliedOrEnded(lead, touchCreatedAt);
}
