import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findSuppression, SUPPRESSED_MESSAGE } from "@/lib/domain/suppression";
import { allowSeedSends, isSeedSource, SEED_BLOCK_MESSAGE } from "@/lib/domain/seed-guard";

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
  const t = await prisma.touch.findUnique({ where: { id: touchId }, select: { lead: { select: { email: true, phone: true, campaign: { select: { orgId: true } } } } } });
  if (!t || !(await findSuppression(t.lead, t.lead.campaign.orgId))) return false;
  const r = await prisma.touch.updateMany({ where, data: { status: "skipped", error: SUPPRESSED_MESSAGE } });
  return r.count > 0;
}

/** Lead respondeu depois da criação do Touch ou sequência encerrada/pausada por resposta/opt-out -> não enviar. */
export function repliedOrEnded(lead: { repliedAt: Date | null; sequenceStatus: string }, touchCreatedAt: Date, closerBypass = false): boolean {
  // Closer: ignora SOMENTE repliedAt e paused_replied; paused_manual (handoff/Assumir/pausa manual) continua bloqueando.
  return (
    (!closerBypass && lead.repliedAt !== null && lead.repliedAt.getTime() > touchCreatedAt.getTime()) ||
    (!closerBypass && lead.sequenceStatus === "paused_replied") || lead.sequenceStatus === "opted_out" || lead.sequenceStatus === "completed" || lead.sequenceStatus === "paused_manual"
  );
}

/**
 * Desvio da SPEC-017 (SPEC-019): SOMENTE Touch gerado pelo agente Closer ignora `repliedOrEnded` (o Closer existe para responder a quem já respondeu).
 * Opt-out, supressão, limites, janela, kill switch e cotas continuam valendo.
 */
export async function isCloserTouch(touch: { id: string; agentGenerated: boolean }): Promise<boolean> {
  if (!touch.agentGenerated) return false;
  const run = await prisma.agentRun.findFirst({ where: { touchId: touch.id, agent: { role: "closer" } }, select: { id: true } });
  return run !== null;
}

/** Relê o lead do banco (não confia no snapshot do início do envio). */
export async function leadStopped(leadId: string, touchCreatedAt: Date, ignoreReplied = false): Promise<boolean> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { repliedAt: true, sequenceStatus: true, optedOutAt: true } });
  return !lead || lead.optedOutAt !== null || lead.sequenceStatus === "opted_out" || lead.sequenceStatus === "completed" || repliedOrEnded(lead, touchCreatedAt, ignoreReplied);
}

/** SPEC-013: lead de seed (`source="seed"`) nunca é enviado (defesa em profundidade; ALLOW_SEED_SENDS=true libera, só dev). Antes de reservar/chamar provider. */
export async function skipSeedBeforeReserve(touchId: string, where: Prisma.TouchWhereInput): Promise<boolean> {
  if (allowSeedSends()) return false;
  const t = await prisma.touch.findUnique({ where: { id: touchId }, select: { lead: { select: { source: true } } } });
  if (!t || !isSeedSource(t.lead.source)) return false;
  const r = await prisma.touch.updateMany({ where, data: { status: "skipped", error: SEED_BLOCK_MESSAGE } });
  return r.count > 0;
}
