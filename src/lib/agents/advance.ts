import { prisma } from "@/lib/prisma";
import { computeNextTouchAt } from "@/lib/scheduler/decide";

/**
 * Passo de agente "estaciona" o lead (nextTouchAt=null) enquanto o rascunho não é resolvido; ao resolver (enviado, rejeitado,
 * expirado, pulado) o lead avança para o próximo passo. Idempotente: só age se o lead ainda está NAQUELE passo.
 */
export async function advanceAfterAgentStep(leadId: string, stepId: string | null, now = new Date()): Promise<boolean> {
  if (!stepId) return false;
  const step = await prisma.sequenceStep.findUnique({ where: { id: stepId }, select: { sequenceId: true } });
  if (!step) return false;
  const steps = await prisma.sequenceStep.findMany({ where: { sequenceId: step.sequenceId }, orderBy: { order: "asc" }, select: { id: true, day: true } });
  const idx = steps.findIndex((s) => s.id === stepId);
  if (idx < 0) return false;
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { sequenceStartedAt: true } });
  if (!lead) return false;
  const next = steps[idx + 1] ?? null;
  const start = lead.sequenceStartedAt ?? now;
  const r = await prisma.lead.updateMany({
    where: { id: leadId, currentStepOrder: idx, sequenceStatus: "active" },
    data: { currentStepOrder: idx + 1, nextTouchAt: computeNextTouchAt(start, next), sequenceStartedAt: start, ...(next ? {} : { sequenceStatus: "completed" as const }) },
  });
  return r.count > 0;
}
