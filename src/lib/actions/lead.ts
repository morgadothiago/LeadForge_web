"use server";

import { withSerializableRetry } from "@/lib/db/tx-conflict";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { runMoveOpportunity, type MoveResult } from "@/lib/domain/move-opportunity";
import { isSuppressed } from "@/lib/domain/suppression";
import { createLeadCore } from "@/lib/domain/lead-create";
import {
  createLeadSchema,
  deleteNoteSchema,
  leadIdSchema,
  MIN_CONTACT_MSG,
  MAX_TAGS,
  moveLeadStageSchema,
  noteSchema,
  tagSchema,
  updateLeadSchema,
} from "@/lib/schemas/lead";
import { failure, formError, safeAction, success, zodErrors, type ActionResult, type FieldErrors } from "./result";

function revalidate(leadId?: string): void {
  revalidatePath("/leads");
  if (leadId) revalidatePath(`/leads/${leadId}`);
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
}

const DUP_EMAIL = "Já existe um lead com este e-mail nesta campanha.";
const DUP_PHONE = "Já existe um lead com este telefone nesta campanha.";

/** Converte P2002 de (campaignId,email)/(campaignId,phone) em erro de campo; null se não for. */
function duplicateErrors(e: unknown): FieldErrors | null {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return null;
  const target = String(((e.meta as { target?: unknown } | undefined)?.target) ?? "");
  if (target.includes("email")) return { email: [DUP_EMAIL] };
  if (target.includes("phone")) return { phone: [DUP_PHONE] };
  return null;
}

/** Pré-checagem amigável (a constraint do banco continua sendo a garantia contra corrida). */
async function checkDuplicates(
  campaignId: string,
  email: string | null | undefined,
  phone: string | null | undefined,
  excludeLeadId?: string,
): Promise<FieldErrors | null> {
  const notSelf = excludeLeadId ? { id: { not: excludeLeadId } } : {};
  const [byEmail, byPhone] = await Promise.all([
    email ? prisma.lead.count({ where: { campaignId, email, ...notSelf } }) : Promise.resolve(0),
    phone ? prisma.lead.count({ where: { campaignId, phone, ...notSelf } }) : Promise.resolve(0),
  ]);
  const errors: FieldErrors = {};
  if (byEmail) errors.email = [DUP_EMAIL];
  if (byPhone) errors.phone = [DUP_PHONE];
  return Object.keys(errors).length ? errors : null;
}

/** Cria lead + Opportunity `novo_lead` (fim da coluna) + StageHistory, numa transação. */
export async function createLead(input: unknown): Promise<ActionResult<{ id: string; opportunityId: string; suppressed?: boolean }>> {
  return safeAction(async () => {
    await requireUser();
    const parsed = createLeadSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const d = parsed.data;
    const campaign = await prisma.campaign.findUnique({ where: { id: d.campaignId }, select: { id: true } });
    if (!campaign) return failure({ campaignId: ["Campanha não encontrada."] });
    const dup = await checkDuplicates(d.campaignId, d.email, d.phone);
    if (dup) return failure(dup);
    try {
      const out = await prisma.$transaction(async (tx) => {
        return createLeadCore(tx, {
          campaignId: d.campaignId,
          name: d.name,
          company: d.company,
          email: d.email,
          phone: d.phone,
          website: d.website,
          linkedin: d.linkedin,
          source: d.source ?? "manual",
        });
      });
      revalidate(out.id);
      // SPEC-017: cria mesmo suprimido (o lead existe para histórico), mas todos os envios ficam bloqueados; aviso via `suppressed`.
      return success({ ...out, suppressed: await isSuppressed({ email: d.email, phone: d.phone }) });
    } catch (e) {
      const dupErr = duplicateErrors(e);
      if (dupErr) return failure(dupErr);
      throw e;
    }
  });
}

/** Atualização parcial (campo ausente = inalterado; null/"" limpa). Campanha imutável (D6). */
export async function updateLead(input: unknown): Promise<ActionResult<{ id: string; suppressed?: boolean }>> {
  return safeAction(async () => {
    await requireUser();
    const parsed = updateLeadSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { leadId, ...d } = parsed.data;
    const current = await prisma.lead.findUnique({ where: { id: leadId }, select: { campaignId: true, email: true, phone: true } });
    if (!current) return formError("Lead não encontrado.");
    const finalEmail = d.email !== undefined ? d.email : current.email;
    const finalPhone = d.phone !== undefined ? d.phone : current.phone;
    if (!finalEmail && !finalPhone) return failure({ email: [MIN_CONTACT_MSG] });
    const dup = await checkDuplicates(current.campaignId, d.email, d.phone, leadId);
    if (dup) return failure(dup);
    const data: Prisma.LeadUpdateInput = {};
    if (d.name !== undefined) data.name = d.name;
    for (const k of ["company", "email", "phone", "website", "linkedin", "source"] as const) {
      if (d[k] !== undefined) data[k] = d[k];
    }
    try {
      await prisma.lead.update({ where: { id: leadId }, data, select: { id: true } });
    } catch (e) {
      const dupErr = duplicateErrors(e);
      if (dupErr) return failure(dupErr);
      throw e;
    }
    revalidate(leadId);
    return success({ id: leadId, suppressed: await isSuppressed({ email: finalEmail, phone: finalPhone }) });
  });
}

/** Normaliza (trim/minúsculas/espaços), ignora duplicata (idempotente) e limita a MAX_TAGS por lead. */
export async function addTag(input: unknown): Promise<ActionResult<{ tags: string[] }>> {
  return safeAction(async () => {
    await requireUser();
    const parsed = tagSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { leadId, tag } = parsed.data;
    const tags = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
      const lead = await tx.lead.findUnique({ where: { id: leadId }, select: { tags: true } });
      if (!lead) return null;
      if (lead.tags.includes(tag)) return { tags: lead.tags, error: null };
      if (lead.tags.length >= MAX_TAGS) return { tags: lead.tags, error: `Limite de ${MAX_TAGS} tags por lead atingido.` };
      const next = [...lead.tags, tag];
      await tx.lead.update({ where: { id: leadId }, data: { tags: next } });
      return { tags: next, error: null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    if (!tags) return formError("Lead não encontrado.");
    if (tags.error) return failure({ tag: [tags.error] });
    revalidate(leadId);
    return success({ tags: tags.tags });
  });
}

export async function removeTag(input: unknown): Promise<ActionResult<{ tags: string[] }>> {
  return safeAction(async () => {
    await requireUser();
    const parsed = tagSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { leadId, tag } = parsed.data;
    const tags = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
      const lead = await tx.lead.findUnique({ where: { id: leadId }, select: { tags: true } });
      if (!lead) return null;
      const next = lead.tags.filter((t) => t !== tag);
      if (next.length !== lead.tags.length) await tx.lead.update({ where: { id: leadId }, data: { tags: next } });
      return next;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    if (!tags) return formError("Lead não encontrado.");
    revalidate(leadId);
    return success({ tags });
  });
}

export async function addNote(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    await requireUser();
    const parsed = noteSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const lead = await prisma.lead.findUnique({ where: { id: parsed.data.leadId }, select: { id: true } });
    if (!lead) return formError("Lead não encontrado.");
    const note = await prisma.leadNote.create({ data: parsed.data, select: { id: true } });
    revalidate(lead.id);
    return success({ id: note.id });
  });
}

export async function deleteNote(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    await requireUser();
    const parsed = deleteNoteSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const note = await prisma.leadNote.delete({ where: { id: parsed.data.noteId }, select: { id: true, leadId: true } });
    revalidate(note.leadId);
    return success({ id: note.id });
  });
}

/** Reusa o núcleo transacional de moveOpportunity (StageHistory, lostReason, encerramento de sequência). Vai ao fim da coluna destino. */
export async function moveLeadStage(input: unknown): Promise<ActionResult<MoveResult>> {
  return safeAction(async () => {
    await requireUser();
    const parsed = moveLeadStageSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { leadId, toStage, lostReason } = parsed.data;
    const opp = await prisma.opportunity.findFirst({
      where: { leadId },
      select: { id: true, campaignId: true },
    });
    if (!opp) return formError("Este lead não possui oportunidade no funil.");
    const outcome = await runMoveOpportunity({
      opportunityId: opp.id,
      toStage,
      toIndex: Number.MAX_SAFE_INTEGER,
      campaignId: opp.campaignId,
      lostReason,
    });
    if (outcome.status === "conflict") return formError("O quadro foi alterado por outra ação. Recarregue e tente novamente.");
    if (outcome.status === "not_found") return formError("Oportunidade não encontrada. Ela pode ter sido movida ou excluída.");
    if (outcome.result.changed) revalidate(leadId);
    return success(outcome.result);
  });
}

/**
 * Exclui o lead (cascade) apenas se nunca houve contato: bloqueia com Touch fora de pending/scheduled/skipped,
 * Touch inbound ou Meeting. Verificação e delete na mesma transação (Serializable).
 */
export async function deleteLead(id: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    await requireUser();
    const parsed = leadIdSchema.safeParse(id);
    if (!parsed.success) return formError("Lead inválido.");
    const leadId = parsed.data;
    try {
      const outcome = await withSerializableRetry(() => prisma.$transaction(
        async (tx) => {
          const lead = await tx.lead.findUnique({ where: { id: leadId }, select: { id: true } });
          if (!lead) return "not_found" as const;
          const [touches, meetings] = await Promise.all([
            tx.touch.count({
              where: {
                leadId,
                OR: [{ direction: "inbound" }, { status: { notIn: ["pending", "scheduled", "skipped"] } }],
              },
            }),
            tx.meeting.count({ where: { leadId } }),
          ]);
          if (touches > 0 || meetings > 0) return "blocked" as const;
          await tx.lead.delete({ where: { id: leadId }, select: { id: true } });
          return "deleted" as const;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ));
      if (outcome === "not_found") return formError("Lead não encontrado.");
      if (outcome === "blocked")
        return formError("Este lead já teve contato (mensagens enviadas, respostas ou reunião) e não pode ser excluído. Mova o lead para Perdido em vez de excluir.");
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003")
        return formError("Não foi possível excluir: o lead possui registros vinculados. Mova o lead para Perdido em vez de excluir.");
      throw e;
    }
    revalidate();
    return success({ id: leadId });
  });
}
