"use server";

import { revalidatePath } from "next/cache";
import { requireActiveProviderOrg } from "@/lib/auth/require-admin";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";
import { resumeInstanceNow } from "@/lib/whatsapp/health";
import { NEEDS_REVIEW_PREFIX } from "@/lib/channels/reserve";
import { retryTouchSchema, whatsappInstanceIdSchema } from "@/lib/schemas/whatsapp";
import { failure, formError, safeAction, success, zodErrors, type ActionResult } from "./result";

const revalidate = (): void => revalidatePath("/configuracoes/whatsapp");

/** Retomada manual: reinicia a rampa um degrau abaixo e zera a janela de métricas. Idempotente (não pausada = sem efeito). */
export async function resumeInstance(instanceId: unknown): Promise<ActionResult<{ id: string; resumed: boolean }>> {
  return safeAction(async () => {
    const { orgId } = await requireActiveProviderOrg();
    const db = scopedPrisma(orgId);
    const pid = whatsappInstanceIdSchema.safeParse(instanceId);
    if (!pid.success) return failure(zodErrors(pid.error));
    const inst = await db.whatsAppInstance.findUnique({ where: { id: pid.data }, select: { id: true, health: true } });
    if (!inst) return formError("Instância não encontrada.");
    if (inst.health !== "paused") return success({ id: inst.id, resumed: false });
    await resumeInstanceNow(inst.id, new Date(), "manual");
    revalidate();
    return success({ id: inst.id, resumed: true });
  });
}

/** Marca como lidos os alertas da instância (some o badge). */
export async function dismissInstanceAlerts(instanceId: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const { orgId } = await requireActiveProviderOrg();
    const db = scopedPrisma(orgId);
    const pid = whatsappInstanceIdSchema.safeParse(instanceId);
    if (!pid.success) return failure(zodErrors(pid.error));
    // Confere que a instância pertence à org antes de tocar os alertas (instanceAlert é indireto via instance).
    if (!(await db.whatsAppInstance.count({ where: { id: pid.data } }))) return formError("Instância não encontrada.");
    await db.instanceAlert.updateMany({ where: { instanceId: pid.data, readAt: null }, data: { readAt: new Date() } });
    revalidate();
    return success({ id: pid.data });
  });
}

/**
 * Reenvio consciente de Touch `failed` por timeout (exige requireUser + confirm:true). Só devolve o Touch para `scheduled` (agora);
 * janela, limites e supressão continuam valendo no envio. Falhas sabidamente seguras já são reservadas automaticamente.
 */
export async function retryTouch(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const { orgId } = await requireActiveProviderOrg();
    const db = scopedPrisma(orgId);
    const parsed = retryTouchSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const r = await db.touch.updateMany({
      where: { id: parsed.data.touchId, channel: "whatsapp", direction: "outbound", status: "failed", error: { startsWith: NEEDS_REVIEW_PREFIX } },
      data: { status: "scheduled", scheduledAt: new Date(), error: null },
    });
    if (!r.count) return formError("Envio não encontrado ou não está aguardando revisão.");
    revalidatePath("/configuracoes/whatsapp");
    return success({ id: parsed.data.touchId });
  });
}
