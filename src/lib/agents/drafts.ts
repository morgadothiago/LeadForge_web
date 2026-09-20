import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/channels/email";
import { sendWhatsApp } from "@/lib/channels/whatsapp";
import { AppError } from "@/lib/errors";
import { advanceAfterAgentStep } from "./advance";
import { DRAFT_TTL_MS } from "./types";

export type DispatchResult =
  | { status: "sent" | "deferred" }
  | { status: "blocked"; reason: string };

/**
 * ÚNICO ponto de envio de agentes: cria o Touch (agentGenerated) e chama sendEmail/sendWhatsApp, que aplicam supressão, cadência
 * (3 toques/14 dias), janela, aquecimento e saúde da SPEC-017. Nenhum outro caminho envia mensagem de agente (teste estático).
 */
export async function dispatchDraft(draftId: string, opts: { reviewer: string | null; editedBody?: string; now?: Date }): Promise<DispatchResult> {
  const now = opts.now ?? new Date();
  const draft = await prisma.draft.findUnique({ where: { id: draftId }, include: { agentRun: { select: { stepId: true, agent: { select: { role: true } } } } } });
  if (!draft) throw new AppError({ code: "not_found", userMessage: "Rascunho não encontrado." });
  if (draft.status !== "pending") throw new AppError({ code: "conflict", userMessage: "Este rascunho já foi tratado." });
  // Closer responde a lead que já respondeu: excecao minima a repliedOrEnded nos canais (isCloserTouch); demais regras da SPEC-017 valem.
  const body = (opts.editedBody ?? draft.body).trim();
  const edited = opts.editedBody !== undefined && opts.editedBody.trim() !== draft.body.trim();
  // Reserva atômica: só um chamador passa de pending.
  const claimed = await prisma.draft.updateMany({
    where: { id: draft.id, status: "pending" },
    data: { status: edited ? "edited" : "approved", editedBody: edited ? body : null, reviewedBy: opts.reviewer, reviewedAt: opts.reviewer ? now : null },
  });
  if (!claimed.count) throw new AppError({ code: "conflict", userMessage: "Este rascunho já foi tratado." });

  const stepId = draft.agentRun.stepId;
  const existing = stepId ? await prisma.touch.findUnique({ where: { leadId_stepId: { leadId: draft.leadId, stepId } }, select: { id: true } }) : null;
  const touch = existing
    ? await prisma.touch.update({ where: { id: existing.id }, data: { content: body, subject: draft.subject, agentGenerated: true, status: "scheduled", scheduledAt: now } })
    : await prisma.touch.create({ data: { leadId: draft.leadId, stepId, channel: draft.channel, status: "scheduled", scheduledAt: now, content: body, subject: draft.subject, agentGenerated: true } });
  await prisma.draft.update({ where: { id: draft.id }, data: { touchId: touch.id } });
  await prisma.agentRun.update({ where: { id: draft.agentRunId }, data: { touchId: touch.id } });

  const r = draft.channel === "whatsapp" ? await sendWhatsApp(touch.id, { now }) : draft.channel === "email" ? await sendEmail(touch.id, { now }) : null;
  if (!r) return blockDraft(draft.id, "Canal sem envio automático.");
  if (r.status === "sent") {
    await prisma.draft.update({ where: { id: draft.id }, data: { status: "sent" } });
    await advanceAfterAgentStep(draft.leadId, stepId, now);
    return { status: "sent" };
  }
  if (r.status === "deferred") return { status: "deferred" }; // Fila A do scheduler envia depois (janela/limite)
  const reason = r.status === "skipped" ? `Política de envio bloqueou (${r.reason}).` : r.status === "failed" ? r.error.userMessage : "Envio não realizado.";
  await advanceAfterAgentStep(draft.leadId, stepId, now);
  return blockDraft(draft.id, reason);
}

async function blockDraft(draftId: string, reason: string): Promise<DispatchResult> {
  await prisma.draft.update({ where: { id: draftId }, data: { status: "blocked", rejectReason: reason.slice(0, 300) } });
  return { status: "blocked", reason };
}

export async function rejectDraft(draftId: string, reviewer: string, reason: string, now = new Date()): Promise<boolean> {
  const draft = await prisma.draft.findUnique({ where: { id: draftId }, select: { leadId: true, agentRun: { select: { stepId: true } } } });
  const r = await prisma.draft.updateMany({ where: { id: draftId, status: "pending" }, data: { status: "rejected", rejectReason: reason.slice(0, 300), reviewedBy: reviewer, reviewedAt: now } });
  if (r.count && draft) await advanceAfterAgentStep(draft.leadId, draft.agentRun.stepId, now);
  return r.count > 0;
}

/** Rascunhos pendentes há mais que o TTL expiram (o lead avança; nada é enviado). */
export async function expireOldDrafts(now = new Date()): Promise<number> {
  const old = await prisma.draft.findMany({ where: { status: "pending", createdAt: { lt: new Date(now.getTime() - DRAFT_TTL_MS) } }, select: { id: true, leadId: true, agentRun: { select: { stepId: true } } }, take: 200 });
  let n = 0;
  for (const d of old) {
    const r = await prisma.draft.updateMany({ where: { id: d.id, status: "pending" }, data: { status: "expired" } });
    if (r.count) { n++; await advanceAfterAgentStep(d.leadId, d.agentRun.stepId, now); }
  }
  return n;
}
