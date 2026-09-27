"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { requireActiveProviderOrg } from "@/lib/auth/require-admin";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";
import { idSchema } from "@/lib/schemas/campaign";
import { templateCreateSchema, templateUpdateSchema } from "@/lib/schemas/template";
import { validateFirstTouchTemplate } from "@/lib/whatsapp/first-touch";
import { expandSpintax } from "@/lib/templates/spintax";
import { renderTemplate } from "@/lib/templates/render";
import { SAMPLE_LEAD } from "@/lib/queries/sequences";
import { failure, formError, safeAction, success, zodErrors, type ActionResult } from "./result";

function revalidate(campaignId: string): void {
  revalidatePath(`/campanhas/${campaignId}`);
  revalidatePath("/sequences");
}

/** SPEC-017: avisos (não bloqueiam) do 1º toque de WhatsApp; vazio para outros canais. */
const warningsFor = (channel: string, body: string): string[] => (channel === "whatsapp" ? validateFirstTouchTemplate(body) : []);

export async function createTemplate(input: unknown): Promise<ActionResult<{ id: string; warnings: string[] }>> {
  return safeAction(async () => {
  const { orgId } = await requireActiveProviderOrg();
  const db = scopedPrisma(orgId);
  const parsed = templateCreateSchema.safeParse(input);
  if (!parsed.success) return failure(zodErrors(parsed.error));
  if (!(await db.campaign.count({ where: { id: parsed.data.campaignId } }))) {
    return failure({ campaignId: ["Campanha não encontrada."] });
  }
  const t = await db.messageTemplate.create({ data: parsed.data, select: { id: true } });
  revalidate(parsed.data.campaignId);
  return success({ ...t, warnings: warningsFor(parsed.data.channel, parsed.data.body) });
  });
}

export async function updateTemplate(input: unknown): Promise<ActionResult<{ id: string; warnings: string[] }>> {
  return safeAction(async () => {
  const { orgId } = await requireActiveProviderOrg();
  const db = scopedPrisma(orgId);
  const parsed = templateUpdateSchema.safeParse(input);
  if (!parsed.success) return failure(zodErrors(parsed.error));
  const { id, ...data } = parsed.data;
  const current = await db.messageTemplate.findUnique({
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
  } else if (!(await db.campaign.count({ where: { id: data.campaignId } }))) {
    return failure({ campaignId: ["Campanha não encontrada."] });
  }
  await db.messageTemplate.update({ where: { id }, data });
  revalidate(data.campaignId);
  return success({ id, warnings: warningsFor(data.channel, data.body) });
  });
}

/** Template usado em passo não é excluído (Restrict), com mensagem listando as sequências. */
export async function deleteTemplate(id: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
  const { orgId } = await requireActiveProviderOrg();
  const db = scopedPrisma(orgId);
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return formError("ID inválido.");
  const t = await db.messageTemplate.findUnique({
    where: { id: parsed.data },
    select: { campaignId: true, steps: { select: { sequence: { select: { name: true } } } } },
  });
  if (!t) return formError("Template não encontrado.");
  if (t.steps.length > 0) {
    const names = [...new Set(t.steps.map((s: { sequence: { name: string } }) => s.sequence.name))].join(", ");
    return formError(`Não é possível excluir: o template é usado em ${t.steps.length} passo(s) da(s) sequência(s) ${names}.`);
  }
  await db.messageTemplate.delete({ where: { id: parsed.data } });
  revalidate(t.campaignId);
  return success({ id: parsed.data });
  });
}

export interface TemplatePreview {
  subject: string | null;
  body: string;
  missing: string[];
  length: number;
  /** SPEC-017 (aditivo): avisos do validador do 1º toque de WhatsApp. */
  warnings?: string[];
}

/** Preview server-side de um rascunho (sem persistir), com lead de exemplo. */
export async function previewTemplate(input: unknown): Promise<ActionResult<TemplatePreview>> {
  return safeAction(async () => {
  await requireUser();
  const parsed = templateCreateSchema.safeParse(input);
  if (!parsed.success) return failure(zodErrors(parsed.error));
  const vars = SAMPLE_LEAD;
  const previewBody = parsed.data.channel === "whatsapp" ? expandSpintax(parsed.data.body, "preview") : parsed.data.body;
  const body = renderTemplate(previewBody, vars, { channel: parsed.data.channel, field: "body" });
  const subject = parsed.data.subject
    ? renderTemplate(parsed.data.subject, vars, { channel: parsed.data.channel, field: "subject" })
    : null;
  if (!body.ok || (subject && !subject.ok)) return formError("Template contém variável desconhecida.");
  const missing = [...new Set([...body.missing, ...(subject && subject.ok ? subject.missing : [])])];
  return success({ subject: subject && subject.ok ? subject.text : null, body: body.text, missing, length: body.text.length, warnings: warningsFor(parsed.data.channel, parsed.data.body) });
  });
}
