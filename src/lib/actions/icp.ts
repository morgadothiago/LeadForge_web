"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { icpInputSchema, icpUpdateSchema } from "@/lib/schemas/icp";
import { idSchema } from "@/lib/schemas/campaign";
import { formError, safeAction, success, zodErrors, type ActionResult } from "./result";

function revalidate(): void {
  revalidatePath("/campanhas");
  revalidatePath("/campanhas/[id]", "page");
}

export async function createIcp(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    await requireUser();
    const parsed = icpInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) };
    const icp = await prisma.icpProfile.create({ data: parsed.data, select: { id: true } });
    revalidate();
    return success(icp);
  });
}

export async function updateIcp(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    await requireUser();
    const parsed = icpUpdateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) };
    const { id, ...data } = parsed.data;
    try {
      await prisma.icpProfile.update({ where: { id }, data });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") return formError("ICP não encontrado.");
      throw e;
    }
    revalidate();
    return success({ id });
  });
}

/** Bloqueia se alguma campanha (inclusive arquivada) usa o ICP. Checagem+delete na mesma transação; P2003 (corrida) vira a mesma mensagem. */
export async function deleteIcp(id: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    await requireUser();
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) return formError("ID inválido.");
    try {
      const res = await prisma.$transaction(async (tx) => {
        const icp = await tx.icpProfile.findUnique({
          where: { id: parsed.data },
          select: { _count: { select: { campaigns: true } } },
        });
        if (!icp) return formError<{ id: string }>("ICP não encontrado.");
        const n = icp._count.campaigns;
        if (n > 0) {
          return formError<{ id: string }>(`Não é possível excluir: o ICP está em uso por ${n} campanha${n > 1 ? "s" : ""}.`);
        }
        await tx.icpProfile.delete({ where: { id: parsed.data } });
        return success({ id: parsed.data });
      });
      if (res.ok) revalidate();
      return res;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        return formError("Não é possível excluir: o ICP está em uso por campanhas.");
      }
      throw e;
    }
  });
}
