"use server";

import { z } from "zod";
import { requireActiveProviderOrg } from "@/lib/auth/require-admin";
import { assertFeature, requiredPlanName } from "@/lib/billing/entitlements";
import { prisma } from "@/lib/prisma";
import { sendManualWhatsApp } from "@/lib/inbox/send-manual";
import { markRead, setStatus } from "@/lib/inbox/conversations";
import type { MessageView } from "@/lib/inbox/messages";
import { failure, formError, safeAction, success, zodErrors, type ActionResult } from "./result";

/**
 * SPEC-068a: Server Actions da caixa de atendimento. `orgId` e `userId` vêm SEMPRE da sessão (nunca do corpo). `owner` e `member` podem tudo;
 * `platform_admin` e sessão sem org são recusados por `requireActiveProviderOrg` (que também barra trial expirado e org suspensa).
 */
const NOT_FOUND = "Conversa não encontrada.";
const uuid = z.string().uuid("Identificador inválido.");

const sendSchema = z.object({ conversationId: uuid, clientMessageId: uuid, text: z.string() });
const idSchema = z.object({ conversationId: uuid });
const statusSchema = z.object({ conversationId: uuid, status: z.enum(["waiting", "attending", "closed"]) });

/** Resposta manual de texto. Erros tipados em `errors.code` (+ `retryAfterSeconds` e `messageId` quando existem). Mesmo `clientMessageId` = sem reenvio. */
export async function sendManualMessage(input: unknown): Promise<ActionResult<{ message: MessageView; duplicate: boolean }>> {
  return safeAction(async () => {
    const { user, orgId } = await requireActiveProviderOrg();
    const parsed = sendSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const r = await sendManualWhatsApp({ orgId, userId: user.id, ...parsed.data });
    if (r.ok) return success({ message: r.message, duplicate: r.duplicate });
    return {
      ok: false,
      errors: {
        _form: [r.error], code: [r.code],
        ...(r.code === "plan_feature_locked" ? { feature: ["inbox.reply"], requiredPlan: [requiredPlanName("inbox.reply")] } : {}),
        ...(r.retryAfterSeconds ? { retryAfterSeconds: [String(r.retryAfterSeconds)] } : {}),
        ...(r.message ? { messageId: [r.message.id] } : {}),
      },
    };
  });
}

/** Zera o não lido (nível org). Idempotente; conversa de outra org = "não encontrada". */
export async function markConversationRead(input: unknown): Promise<ActionResult<{ conversationId: string }>> {
  return safeAction(async () => {
    const { orgId } = await requireActiveProviderOrg();
    const parsed = idSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    if (!(await markRead(orgId, parsed.data.conversationId))) return formError(NOT_FOUND);
    return success({ conversationId: parsed.data.conversationId });
  });
}

/** Encerrar (`closed`) ou reabrir (`waiting`/`attending`) a conversa. */
export async function setConversationStatus(input: unknown): Promise<ActionResult<{ conversationId: string; status: "waiting" | "attending" | "closed" }>> {
  return safeAction(async () => {
    const { orgId } = await requireActiveProviderOrg();
    const parsed = statusSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    await assertFeature(prisma, orgId, "inbox.reply"); // SPEC-069b: Free = so leitura (marcar como lida continua liberado)
    if (!(await setStatus(orgId, parsed.data.conversationId, parsed.data.status))) return formError(NOT_FOUND);
    return success(parsed.data);
  });
}
