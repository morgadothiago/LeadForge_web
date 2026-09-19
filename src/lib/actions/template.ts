"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { idSchema } from "@/lib/schemas/campaign";
import { templateCreateSchema, templateUpdateSchema } from "@/lib/schemas/template";
import { renderTemplate } from "@/lib/templates/render";
import { SAMPLE_LEAD } from "@/lib/queries/sequences";
import { failure, formError, safeAction, success, zodErrors, type ActionResult } from "./result";

function revalidate(campaignId: string): void {
  revalidatePath(`/campanhas/${campaignId}`);
  revalidatePath("/sequences");
}

export async function createTemplate(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
  await requireUser();
  const parsed = templateCreateSchema.safeParse(input);
  if (!parsed.success) return failure(zodErrors(parsed.error));
  if (!(await prisma.campaign.count({ where: { id: parsed.data.campaignId } }))) {
    return failure({ campaignId: ["Campanha não encontrada."] });
  }
  const t = await prisma.messageTemplate.create({ data: parsed.data, select: { id: true } });
  revalidate(parsed.data.campaignId);
  return success(t);
  });
}

export async function updateTemplate(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
  await requireUser();
  const parsed = templateUpdateSchema.safeParse(input);
  if (!parsed.success) return failure(zodErrors(parsed.error));
  const { id, ...data } = parsed.data;
  const current = await prisma.messageTemplate.findUnique({
    where: { id },
    select: { campaignId: true, channel: true, _count: { select: { steps: true } } },
  });
  if (!current) return formError("Template não encontrado.");
  if (current._count.steps > 0) {
    if (current.channel !== data.channel) {
      return failure({ channel: ["Não é possível trocar o canal: o template é usado em passos de sequência."] });
    }
    if (current.campaignId !== data.campaignId) {
      return failure({ campaignId: ["Não é possível mover o template: ele é usado em passos de sequência."] });
    }
  } else if (!(await prisma.campaign.count({ where: { id: data.campaignId } }))) {
    return failure({ campaignId: ["Campanha não encontrada."] });
  }
  await prisma.messageTemplate.update({ where: { id }, data });
  revalidate(data.campaignId);
  return success({ id });
  });
}

/** Template usado em passo não é excluído (Restrict), com mensagem listando as sequências. */
export async function deleteTemplate(id: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
  await requireUser();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return formError("ID inválido.");
  const t = await prisma.messageTemplate.findUnique({
    where: { id: parsed.data },
    select: { campaignId: true, steps: { select: { sequence: { select: { name: true } } } } },
  });
  if (!t) return formError("Template não encontrado.");
  if (t.steps.length > 0) {
    const names = [...new Set(t.steps.map((s) => s.sequence.name))].join(", ");
    return formError(`Não é possível excluir: o template é usado em ${t.steps.length} passo(s) da(s) sequência(s) ${names}.`);
  }
  await prisma.messageTemplate.delete({ where: { id: parsed.data } });
  revalidate(t.campaignId);
  return success({ id: parsed.data });
  });
}

export interface TemplatePreview {
  subject: string | null;
  body: string;
  missing: string[];
  length: number;
}

/** Preview server-side de um rascunho (sem persistir), com lead de exemplo. */
export async function previewTemplate(input: unknown): Promise<ActionResult<TemplatePreview>> {
  return safeAction(async () => {
  await requireUser();
  const parsed = templateCreateSchema.safeParse(input);
  if (!parsed.success) return failure(zodErrors(parsed.error));
  const vars = SAMPLE_LEAD;
  const body = renderTemplate(parsed.data.body, vars, { channel: parsed.data.channel, field: "body" });
  const subject = parsed.data.subject
    ? renderTemplate(parsed.data.subject, vars, { channel: parsed.data.channel, field: "subject" })
    : null;
  if (!body.ok || (subject && !subject.ok)) return formError("Template contém variável desconhecida.");
  const missing = [...new Set([...body.missing, ...(subject && subject.ok ? subject.missing : [])])];
  return success({ subject: subject && subject.ok ? subject.text : null, body: body.text, missing, length: body.text.length });
  });
}
