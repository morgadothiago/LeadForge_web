"use server";

import { revalidatePath } from "next/cache";
import type { CampaignStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { campaignCreateSchema, campaignUpdateSchema, idSchema } from "@/lib/schemas/campaign";
import { Prisma } from "@prisma/client";
import { failure, formError, safeAction, success, zodErrors, type ActionResult, type FieldErrors } from "./result";

function revalidate(id?: string): void {
  revalidatePath("/campanhas");
  if (id) revalidatePath(`/campanhas/${id}`);
  revalidatePath("/dashboard"); // dashboard
}

/** Valida existência das FKs opcionais, devolvendo erro por campo em PT-BR. */
async function checkRefs(refs: {
  icpId?: string;
  sequenceId: string | null;
  whatsappInstanceId: string | null;
}): Promise<FieldErrors | null> {
  const [icp, seq, wa] = await Promise.all([
    refs.icpId ? prisma.icpProfile.count({ where: { id: refs.icpId } }) : Promise.resolve(1),
    refs.sequenceId ? prisma.sequence.count({ where: { id: refs.sequenceId } }) : Promise.resolve(1),
    refs.whatsappInstanceId
      ? prisma.whatsAppInstance.count({ where: { id: refs.whatsappInstanceId } })
      : Promise.resolve(1),
  ]);
  const errors: FieldErrors = {};
  if (!icp) errors.icpId = ["ICP não encontrado."];
  if (!seq) errors.sequenceId = ["Sequência não encontrada."];
  if (!wa) errors.whatsappInstanceId = ["Instância de WhatsApp não encontrada."];
  return Object.keys(errors).length ? errors : null;
}

export async function createCampaign(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const user = await requireUser();
    const parsed = campaignCreateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) };
    const { icp, icpId, sequenceId, whatsappInstanceId, name, description, status, autoStart } = parsed.data;
    const refErrors = await checkRefs({ icpId, sequenceId, whatsappInstanceId });
    if (refErrors) return failure(refErrors);

    const campaign = await prisma.$transaction(async (tx) => {
      const resolvedIcpId = icp ? (await tx.icpProfile.create({ data: icp, select: { id: true } })).id : icpId;
      if (!resolvedIcpId) throw new Error("icpId ausente após validação.");
      return tx.campaign.create({
        data: { name, description, status, ...(autoStart !== undefined ? { autoStart } : {}), sequenceId, whatsappInstanceId, userId: user.id, icpId: resolvedIcpId },
        select: { id: true },
      });
    });
    revalidate(campaign.id);
    return success(campaign);
  });
}

export async function updateCampaign(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    await requireUser();
    const parsed = campaignUpdateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) };
    const { id, ...data } = parsed.data;
    if (!(await prisma.campaign.count({ where: { id } }))) return formError("Campanha não encontrada.");
    const refErrors = await checkRefs(data);
    if (refErrors) return failure(refErrors);
    await prisma.campaign.update({ where: { id }, data });
    revalidate(id);
    return success({ id });
  });
}

async function setStatus(id: unknown, status: CampaignStatus): Promise<ActionResult<{ id: string; status: CampaignStatus }>> {
  return safeAction(async () => {
    await requireUser();
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) return formError("ID inválido.");
    if (!(await prisma.campaign.count({ where: { id: parsed.data } }))) return formError("Campanha não encontrada.");
    await prisma.campaign.update({ where: { id: parsed.data }, data: { status } });
    revalidate(parsed.data);
    return success({ id: parsed.data, status });
  });
}

export async function pauseCampaign(id: unknown) {
  return setStatus(id, "paused");
}
export async function resumeCampaign(id: unknown) {
  return setStatus(id, "active");
}
export async function archiveCampaign(id: unknown) {
  return setStatus(id, "archived");
}

/** Copia configuração (ICP, sequência, instância); não copia leads nem templates. Nasce pausada. */
export async function duplicateCampaign(id: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const user = await requireUser();
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) return formError("ID inválido.");
    const src = await prisma.campaign.findUnique({ where: { id: parsed.data } });
    if (!src) return formError("Campanha não encontrada.");
    const copy = await prisma.campaign.create({
      data: {
        name: `${src.name} (cópia)`.slice(0, 120),
        description: src.description,
        status: "paused",
        icpId: src.icpId,
        sequenceId: src.sequenceId,
        whatsappInstanceId: src.whatsappInstanceId,
        userId: user.id,
      },
      select: { id: true },
    });
    revalidate(copy.id);
    return success(copy);
  });
}

const blockedMsg = (n: number): string =>
  `Não é possível excluir: a campanha possui ${n} lead${n > 1 ? "s" : ""}. Arquive-a em vez disso.`;

/** Campanha com leads não pode ser excluída (só arquivada). */
export async function deleteCampaign(id: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    await requireUser();
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) return formError("ID inválido.");
    try {
      const res = await prisma.$transaction(async (tx) => {
        const c = await tx.campaign.findUnique({
          where: { id: parsed.data },
          select: { _count: { select: { leads: true } } },
        });
        if (!c) return formError<{ id: string }>("Campanha não encontrada.");
        if (c._count.leads > 0) return formError<{ id: string }>(blockedMsg(c._count.leads));
        await tx.campaign.delete({ where: { id: parsed.data } });
        return success({ id: parsed.data });
      });
      if (res.ok) revalidate(parsed.data);
      return res;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        return formError("Não é possível excluir: a campanha possui leads. Arquive-a em vez disso.");
      }
      throw e;
    }
  });
}
