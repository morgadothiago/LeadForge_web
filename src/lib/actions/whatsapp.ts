"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { encrypt } from "@/lib/crypto/secret-box";
import { AppError, safeErrorForLog } from "@/lib/errors";
import { buildWebhookUrl, getWhatsAppProvider, type ConnectionState } from "@/lib/whatsapp/provider";
import { sanitizeError } from "@/lib/channels/email";
import { applyOptOut } from "@/lib/domain/whatsapp-inbound";
import { maskedWebhookUrl, tokenHint } from "@/lib/whatsapp/redact";
import { leadIdSchema, whatsappInstanceCreateSchema, whatsappInstanceIdSchema, whatsappInstanceUpdateSchema } from "@/lib/schemas/whatsapp";
import { failure, formError, safeAction, success, zodErrors, type ActionResult } from "./result";

const DUP = { instanceName: ["Já existe uma instância com este nome."] };
const NOT_FOUND = "Instância não encontrada.";
const revalidate = (): void => revalidatePath("/configuracoes/whatsapp");
const isDup = (e: unknown): boolean => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const STATUS: Record<ConnectionState, "connected" | "connecting" | "disconnected"> = { connected: "connected", connecting: "connecting", disconnected: "disconnected" };

async function record(id: string, status: ConnectionState, err?: unknown): Promise<void> {
  await prisma.whatsAppInstance.update({
    where: { id },
    data: err
      ? { lastError: sanitizeError(err instanceof AppError ? err.userMessage : "Falha ao consultar o provider.") }
      : { status: STATUS[status], lastError: null, ...(status === "connected" ? { lastConnectedAt: new Date() } : {}) },
  });
}

export async function createWhatsAppInstance(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    await requireUser();
    const parsed = whatsappInstanceCreateSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { instanceName, number, dailyLimit } = parsed.data;
    if (await prisma.whatsAppInstance.count({ where: { instanceName } })) return failure(DUP);
    const webhookToken = randomBytes(32).toString("base64url");
    const provider = getWhatsAppProvider("evolution");
    const created = await provider.createInstance({ instanceName, number, webhookUrl: buildWebhookUrl({ webhookToken }) });
    try {
      const row = await prisma.whatsAppInstance.create({
        data: {
          instanceName, number, dailyLimit, webhookToken, provider: "evolution", status: "connecting",
          apiKey: created.apiKey ? encrypt(created.apiKey) : null,
        },
        select: { id: true },
      });
      revalidate();
      return success(row);
    } catch (e) {
      // Não deixar instância órfã no provider se a gravação falhar.
      await provider.deleteInstance?.(instanceName).catch((d) => console.error("[whatsapp] limpeza falhou:", safeErrorForLog(d)));
      if (isDup(e)) return failure(DUP);
      throw e;
    }
  });
}

export async function getInstanceQr(id: unknown): Promise<ActionResult<{ qrCode: string | null; pairingCode: string | null }>> {
  return safeAction(async () => {
    await requireUser();
    const pid = whatsappInstanceIdSchema.safeParse(id);
    if (!pid.success) return failure(zodErrors(pid.error));
    const inst = await prisma.whatsAppInstance.findUnique({ where: { id: pid.data } });
    if (!inst) return formError(NOT_FOUND);
    try {
      const qr = await getWhatsAppProvider(inst.provider).getQr(inst.instanceName);
      await prisma.whatsAppInstance.update({ where: { id: inst.id }, data: { lastError: null } });
      return success({ qrCode: qr.qrCode, pairingCode: qr.pairingCode ?? null });
    } catch (e) {
      await record(inst.id, "disconnected", e);
      throw e;
    }
  });
}

export async function refreshInstanceStatus(id: unknown): Promise<ActionResult<{ status: ConnectionState }>> {
  return safeAction(async () => {
    await requireUser();
    const pid = whatsappInstanceIdSchema.safeParse(id);
    if (!pid.success) return failure(zodErrors(pid.error));
    const inst = await prisma.whatsAppInstance.findUnique({ where: { id: pid.data } });
    if (!inst) return formError(NOT_FOUND);
    try {
      const { status } = await getWhatsAppProvider(inst.provider).getStatus(inst.instanceName);
      await record(inst.id, status);
      revalidate();
      return success({ status });
    } catch (e) {
      await record(inst.id, "disconnected", e);
      throw e;
    }
  });
}

export async function updateInstance(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    await requireUser();
    const parsed = whatsappInstanceUpdateSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const { id, number, dailyLimit } = parsed.data;
    const r = await prisma.whatsAppInstance.updateMany({ where: { id }, data: { dailyLimit, ...(number ? { number } : {}) } });
    if (!r.count) return formError(NOT_FOUND);
    revalidate();
    return success({ id });
  });
}

export async function deleteWhatsAppInstance(id: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    await requireUser();
    const pid = whatsappInstanceIdSchema.safeParse(id);
    if (!pid.success) return failure(zodErrors(pid.error));
    const inst = await prisma.whatsAppInstance.findUnique({ where: { id: pid.data }, include: { _count: { select: { campaigns: true } } } });
    if (!inst) return formError(NOT_FOUND);
    const n = inst._count.campaigns;
    if (n > 0) return formError(`Não é possível excluir: ${n} campanha${n > 1 ? "s usam" : " usa"} esta instância. Desvincule-${n > 1 ? "as" : "a"} antes.`);
    try {
      await getWhatsAppProvider(inst.provider).deleteInstance?.(inst.instanceName);
    } catch (e) {
      if (!(e instanceof AppError && e.code === "not_found")) throw e;
    }
    await prisma.whatsAppInstance.delete({ where: { id: inst.id } });
    revalidate();
    return success({ id: inst.id });
  });
}

/** Desconecta (logout) a sessão, se o provider suportar. */
export async function disconnectInstance(id: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    await requireUser();
    const pid = whatsappInstanceIdSchema.safeParse(id);
    if (!pid.success) return failure(zodErrors(pid.error));
    const inst = await prisma.whatsAppInstance.findUnique({ where: { id: pid.data } });
    if (!inst) return formError(NOT_FOUND);
    const provider = getWhatsAppProvider(inst.provider);
    if (!provider.logoutInstance) return formError("O provider desta instância não suporta desconectar.");
    await provider.logoutInstance(inst.instanceName);
    await record(inst.id, "disconnected");
    revalidate();
    return success({ id: inst.id });
  });
}

/** Única saída do token completo: detalhe autenticado, para configurar o webhook manualmente se preciso. `url` já contém o token (caminho). */
export async function getInstanceWebhookConfig(id: unknown): Promise<ActionResult<{ url: string; token: string }>> {
  return safeAction(async () => {
    await requireUser();
    const pid = whatsappInstanceIdSchema.safeParse(id);
    if (!pid.success) return failure(zodErrors(pid.error));
    const inst = await prisma.whatsAppInstance.findUnique({ where: { id: pid.data }, select: { webhookToken: true } });
    if (!inst) return formError(NOT_FOUND);
    return success({ url: buildWebhookUrl(inst), token: inst.webhookToken });
  });
}

/**
 * Gera novo token (32 bytes base64url), reconfigura o webhook no provider e SÓ ENTÃO grava no banco (falha no provider = token antigo segue válido).
 * Se a gravação falhar depois de o provider já apontar para a URL nova, tenta reverter o provider para a URL antiga. O antigo deixa de autenticar
 * imediatamente. Devolve URL MASCARADA e as 4 últimas letras: o token completo só sai por getInstanceWebhookConfig.
 */
export async function rotateWebhookToken(instanceId: unknown): Promise<ActionResult<{ webhookUrl: string; tokenHint: string }>> {
  return safeAction(async () => {
    await requireUser();
    const pid = whatsappInstanceIdSchema.safeParse(instanceId);
    if (!pid.success) return failure(zodErrors(pid.error));
    const inst = await prisma.whatsAppInstance.findUnique({ where: { id: pid.data } });
    if (!inst) return formError(NOT_FOUND);
    const provider = getWhatsAppProvider(inst.provider);
    const newToken = randomBytes(32).toString("base64url");
    const oldUrl = buildWebhookUrl(inst);
    const newUrl = buildWebhookUrl({ webhookToken: newToken });
    await provider.configureWebhook({ instanceName: inst.instanceName, webhookUrl: newUrl });
    try {
      const r = await prisma.whatsAppInstance.updateMany({ where: { id: inst.id, webhookToken: inst.webhookToken }, data: { webhookToken: newToken } });
      if (!r.count) throw new AppError({ code: "conflict", userMessage: "O token foi alterado por outra operação. Recarregue e tente novamente." });
    } catch (e) {
      await provider.configureWebhook({ instanceName: inst.instanceName, webhookUrl: oldUrl }).catch((d) => console.error("[whatsapp] reversão do webhook falhou:", safeErrorForLog(d)));
      throw e;
    }
    revalidate();
    return success({ webhookUrl: maskedWebhookUrl(newUrl, newToken), tokenHint: tokenHint(newToken) });
  });
}

const revalidateLead = (id: string): void => {
  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
  revalidatePath("/pipeline");
  revalidatePath("/");
};

/** Confirma o opt-out sugerido (possibleOptOut): mesmo efeito do opt-out automático. Idempotente. */
export async function confirmOptOut(leadId: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    await requireUser();
    const pid = leadIdSchema.safeParse(leadId);
    if (!pid.success) return failure(zodErrors(pid.error));
    const lead = await prisma.lead.findUnique({ where: { id: pid.data }, select: { id: true, opportunities: { select: { id: true, stage: true }, take: 1 } } });
    if (!lead) return formError("Lead não encontrado.");
    await prisma.$transaction(
      (tx) => applyOptOut(tx, lead.id, lead.opportunities[0] ?? null, new Date()),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    revalidateLead(lead.id);
    return success({ id: lead.id });
  });
}

/** Descarta o alerta "Possível opt-out". */
export async function dismissPossibleOptOut(leadId: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    await requireUser();
    const pid = leadIdSchema.safeParse(leadId);
    if (!pid.success) return failure(zodErrors(pid.error));
    const r = await prisma.lead.updateMany({ where: { id: pid.data }, data: { possibleOptOut: false } });
    if (!r.count) return formError("Lead não encontrado.");
    revalidateLead(pid.data);
    return success({ id: pid.data });
  });
}
