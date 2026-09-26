"use server";

import { withSerializableRetry } from "@/lib/db/tx-conflict";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireProviderOrg } from "@/lib/auth/require-admin";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";
import { addSuppression } from "@/lib/domain/suppression";
import { addToSuppressionSchema, removeFromSuppressionSchema } from "@/lib/schemas/suppression";
import { failure, formError, safeAction, success, zodErrors, type ActionResult } from "./result";

const revalidate = (leadId?: string): void => {
  revalidatePath("/leads");
  if (leadId) revalidatePath(`/leads/${leadId}`);
  revalidatePath("/pipeline");
};

/**
 * Adiciona à supressão (por-org desde SPEC-030; por lead OU por contato solto). Com `leadId`: grava e-mail + telefone do lead
 * e encerra o lead (opted_out, cancela toques pendentes), como o descadastro. Idempotente. Manual/bounce/opt_out_manual.
 */
export async function addToSuppression(input: unknown): Promise<ActionResult<{ added: number }>> {
  return safeAction(async () => {
    const { orgId } = await requireProviderOrg();
    const parsed = addToSuppressionSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { leadId, reason, note } = parsed.data;
    const now = new Date();
    let { email, phone } = parsed.data;
    if (leadId) {
      const lead = await scopedPrisma(orgId).lead.findUnique({ where: { id: leadId }, select: { email: true, phone: true } });
      if (!lead) return formError("Lead não encontrado.");
      email = email ?? lead.email ?? undefined;
      phone = phone ?? lead.phone ?? undefined;
    }
    const added = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
      const n = await addSuppression(tx, orgId, { email, phone, reason, leadId, note });
      if (leadId) {
        await tx.lead.updateMany({ where: { id: leadId, optedOutAt: null }, data: { optedOutAt: now } });
        await tx.lead.update({ where: { id: leadId }, data: { sequenceStatus: "opted_out", nextTouchAt: null, possibleOptOut: false } });
        await tx.touch.updateMany({ where: { leadId, direction: "outbound", status: { in: ["pending", "scheduled"] } }, data: { status: "skipped" } });
      }
      return n;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    if (added === 0) return failure({ leadId: ["O lead não tem e-mail ou telefone válido para suprimir."] });
    revalidate(leadId);
    return success({ added });
  });
}

/**
 * Remove da supressão (desta org) com confirmação explícita e motivo registrado (WebhookEvent source "suppression", sem o contato em claro).
 * Não reabre leads já encerrados: só libera o contato para novos leads/campanhas.
 */
export async function removeFromSuppression(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const { user, orgId } = await requireProviderOrg();
    const parsed = removeFromSuppressionSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { id, reason } = parsed.data;
    const row = await scopedPrisma(orgId).suppression.findUnique({ where: { id } });
    if (!row) return formError("Registro de supressão não encontrado.");
    await prisma.$transaction([
      prisma.suppression.delete({ where: { id } }),
      prisma.webhookEvent.create({
        data: {
          source: "suppression", orgId, processedAt: new Date(),
          payload: { action: "removed", kind: row.kind, originalReason: row.reason, leadId: row.leadId, removedBy: user.id, reason },
        },
      }),
    ]);
    revalidate(row.leadId ?? undefined);
    return success({ id });
  });
}
