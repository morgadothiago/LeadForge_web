"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireProviderOrg } from "@/lib/auth/require-admin";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";
import { idSchema } from "@/lib/schemas/campaign";
import {
  reorderSchema,
  sequenceCreateSchema,
  sequenceRenameSchema,
  sequenceStepsSchema,
} from "@/lib/schemas/sequence";
import type { StepInput } from "@/lib/schemas/sequence";
import { failure, formError, safeAction, success, zodErrors, type ActionResult, type FieldErrors } from "./result";

function revalidate(id?: string): void {
  revalidatePath("/sequences");
  if (id) revalidatePath(`/sequences/${id}`);
  revalidatePath("/campanhas");
}

/**
 * Regras: template existe (e é DESTA org), canal do step == canal do template, e todos os templates da
 * sequência pertencem à MESMA campanha (Sequence não tem campaignId; ver SPEC, seção Backend).
 */
async function validateSteps(orgId: string, steps: StepInput[]): Promise<FieldErrors | null> {
  const ids = [...new Set(steps.map((s) => s.templateId))];
  const templates = await scopedPrisma(orgId).messageTemplate.findMany({
    where: { id: { in: ids } },
    select: { id: true, channel: true, campaignId: true },
  });
  const byId = new Map<string, { id: string; channel: string; campaignId: string }>(
    templates.map((t: { id: string; channel: string; campaignId: string }) => [t.id, t]),
  );
  const errors: FieldErrors = {};
  const add = (k: string, m: string) => (errors[k] ??= []).push(m);
  steps.forEach((s, i) => {
    const t = byId.get(s.templateId);
    if (!t) return add(`steps.${i}.templateId`, "Template não encontrado.");
    if (t.channel !== s.channel) add(`steps.${i}.templateId`, "O canal do passo é diferente do canal do template.");
  });
  if (new Set(templates.map((t: { campaignId: string }) => t.campaignId)).size > 1) {
    add("steps", "Todos os templates da sequência devem pertencer à mesma campanha.");
  }
  return Object.keys(errors).length ? errors : null;
}

async function activeCampaignCount(orgId: string, sequenceId: string): Promise<number> {
  return scopedPrisma(orgId).campaign.count({ where: { sequenceId, status: "active" } });
}

export interface SequenceSaved {
  id: string;
  /** Campanhas ativas que usam a sequência (aviso: a edição afeta os próximos toques). */
  activeCampaigns: number;
}

export async function createSequence(input: unknown): Promise<ActionResult<SequenceSaved>> {
  return safeAction(async () => {
  const { orgId } = await requireProviderOrg();
  const parsed = sequenceCreateSchema.safeParse(input);
  if (!parsed.success) return failure(zodErrors(parsed.error));
  const errs = await validateSteps(orgId, parsed.data.steps);
  if (errs) return failure(errs);
  const seq = await scopedPrisma(orgId).sequence.create({
    data: {
      name: parsed.data.name,
      steps: { create: parsed.data.steps.map((s, order) => ({ ...s, order })) },
    },
    select: { id: true },
  });
  revalidate(seq.id);
  return success({ id: seq.id, activeCampaigns: 0 });
  });
}

export async function renameSequence(input: unknown): Promise<ActionResult<SequenceSaved>> {
  return safeAction(async () => {
  const { orgId } = await requireProviderOrg();
  const db = scopedPrisma(orgId);
  const parsed = sequenceRenameSchema.safeParse(input);
  if (!parsed.success) return failure(zodErrors(parsed.error));
  if (!(await db.sequence.count({ where: { id: parsed.data.id } }))) return formError("Sequência não encontrada.");
  await db.sequence.update({ where: { id: parsed.data.id }, data: { name: parsed.data.name } });
  revalidate(parsed.data.id);
  return success({ id: parsed.data.id, activeCampaigns: await activeCampaignCount(orgId, parsed.data.id) });
  });
}

/** Renumera dentro da transação em duas fases (ordens negativas temporárias) por causa do @@unique. */
async function applyOrders(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i++) await tx.sequenceStep.update({ where: { id: ids[i] }, data: { order: -(i + 1) } });
  for (let i = 0; i < ids.length; i++) await tx.sequenceStep.update({ where: { id: ids[i] }, data: { order: i } });
}

/**
 * Substitui a lista de passos (ordem = índice). Passos com `id` são preservados (mantêm touches);
 * os ausentes são removidos; sem `id` são criados. Tudo em uma transação.
 */
export async function saveSequenceSteps(input: unknown): Promise<ActionResult<SequenceSaved>> {
  return safeAction(async () => {
  const { orgId } = await requireProviderOrg();
  const db = scopedPrisma(orgId);
  const parsed = sequenceStepsSchema.safeParse(input);
  if (!parsed.success) return failure(zodErrors(parsed.error));
  const { sequenceId, steps } = parsed.data;
  const existing = await db.sequenceStep.findMany({ where: { sequenceId }, select: { id: true } });
  if (!existing.length && !(await db.sequence.count({ where: { id: sequenceId } }))) {
    return formError("Sequência não encontrada.");
  }
  const own = new Set(existing.map((e: { id: string }) => e.id));
  const keptIds = steps.flatMap((s) => (s.id ? [s.id] : []));
  if (keptIds.some((id) => !own.has(id)) || new Set(keptIds).size !== keptIds.length) {
    return failure({ steps: ["Passo inválido para esta sequência."] });
  }
  const errs = await validateSteps(orgId, steps);
  if (errs) return failure(errs);

  // Sequence/SequenceStep já foram validados como desta org acima; a transação em si roda no client cru (fora do scopedPrisma).
  await prisma.$transaction(async (tx) => {
    await tx.sequenceStep.deleteMany({ where: { sequenceId, id: { notIn: keptIds } } });
    await applyOrders(tx, keptIds);
    // fase final: dados + ordem definitiva; novos entram após os mantidos com order temporária alta
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (s.id) {
        await tx.sequenceStep.update({
          where: { id: s.id },
          data: { day: s.day, channel: s.channel, templateId: s.templateId, order: 10_000 + i },
        });
      }
    }
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (!s.id) {
        await tx.sequenceStep.create({
          data: { sequenceId, day: s.day, channel: s.channel, templateId: s.templateId, order: 10_000 + i },
        });
      }
    }
    const all = await tx.sequenceStep.findMany({ where: { sequenceId }, orderBy: { order: "asc" }, select: { id: true } });
    await applyOrders(tx, all.map((a) => a.id));
  });
  revalidate(sequenceId);
  return success({ id: sequenceId, activeCampaigns: await activeCampaignCount(orgId, sequenceId) });
  });
}

/** Reordena passos existentes (permutação completa). Dias resultantes precisam continuar não decrescentes. */
export async function reorderSteps(input: unknown): Promise<ActionResult<SequenceSaved>> {
  return safeAction(async () => {
  const { orgId } = await requireProviderOrg();
  const db = scopedPrisma(orgId);
  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) return failure(zodErrors(parsed.error));
  const { sequenceId, stepIds } = parsed.data;
  const steps = await db.sequenceStep.findMany({ where: { sequenceId }, select: { id: true, day: true } });
  const byId = new Map(steps.map((s: { id: string; day: number }) => [s.id, s]));
  if (steps.length !== stepIds.length || new Set(stepIds).size !== stepIds.length || stepIds.some((id) => !byId.has(id))) {
    return formError("A lista de passos deve conter exatamente os passos da sequência.");
  }
  for (let i = 1; i < stepIds.length; i++) {
    if ((byId.get(stepIds[i]) as { day: number }).day < (byId.get(stepIds[i - 1]) as { day: number }).day) {
      return formError("A nova ordem deixaria os dias decrescentes. Ajuste o dia do passo.");
    }
  }
  await prisma.$transaction((tx) => applyOrders(tx, stepIds));
  revalidate(sequenceId);
  return success({ id: sequenceId, activeCampaigns: await activeCampaignCount(orgId, sequenceId) });
  });
}

/** Nova sequência independente (ids novos); templates são compartilhados (mesma campanha). */
export async function duplicateSequence(id: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
  const { orgId } = await requireProviderOrg();
  const db = scopedPrisma(orgId);
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return formError("ID inválido.");
  const src = await db.sequence.findUnique({
    where: { id: parsed.data },
    select: { name: true, steps: { orderBy: { order: "asc" }, select: { day: true, channel: true, templateId: true, order: true } } },
  });
  if (!src) return formError("Sequência não encontrada.");
  const copy = await db.sequence.create({
    data: { name: `${src.name} (cópia)`.slice(0, 120), steps: { create: src.steps } },
    select: { id: true },
  });
  revalidate(copy.id);
  return success(copy);
  });
}

/** Bloqueia exclusão se campanha ativa usa a sequência; demais campanhas ficam sem sequência (SetNull). */
export async function deleteSequence(id: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
  const { orgId } = await requireProviderOrg();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return formError("ID inválido.");
  const sid = parsed.data;
  if (!(await scopedPrisma(orgId).sequence.findUnique({ where: { id: sid }, select: { id: true } }))) return formError("Sequência não encontrada.");
  // checagem + escrita na mesma transação; P2025 (já removida) é tratado por safeAction
  const active = await prisma.$transaction(async (tx) => {
    const n = await tx.campaign.count({ where: { sequenceId: sid, status: "active" } });
    if (n === 0) await tx.sequence.delete({ where: { id: sid } });
    return n;
  });
  if (active > 0) {
    return formError(`Não é possível excluir: ${active} campanha(s) ativa(s) usam esta sequência. Pause-as ou troque a sequência.`);
  }
  revalidate(parsed.data);
  return success({ id: parsed.data });
  });
}
