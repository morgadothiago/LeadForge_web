import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { findSuppression } from "@/lib/domain/suppression";
import { getWhatsAppProvider, type WhatsAppProvider } from "@/lib/whatsapp/provider";
import { effectiveDailyLimit } from "@/lib/whatsapp/warmup";
import { loadOrgAccess } from "@/lib/billing/org-access";
import { monthKey, nextBrtDayStart } from "@/lib/billing/usage";
import { stopAgentOnManualReply } from "@/lib/agents/lead-state";
import { recordOrgAudit } from "@/lib/org/audit";
import { sanitizeError, startOfDaySP } from "@/lib/channels/email";
import { TIMEOUT_WARNING } from "@/lib/channels/whatsapp";
import { CONVERSATION_WINDOW_MS, MANUAL_MAX_PER_MINUTE, MANUAL_MIN_GAP_MS, MANUAL_REPLIES_METRIC, MESSAGE_MAX_CHARS } from "./constants";
import { instancePaused } from "./conversations";
import { toMessageView, type MessageView } from "./messages";
import { buildPreview, hasControlChars } from "./text";
import { UUID_RE } from "./cursor";

/**
 * SPEC-068a (D-068-3/4/5) — resposta manual de texto. NÃO reutiliza `sendWhatsApp(touchId)` (orientado a Touch/sequência); reaproveita os helpers de
 * `src/lib/whatsapp/*`, a supressão e o provider. Ordem das guardas: acesso da org (trial/suspensa) + e-mail verificado + papel -> conversa da org
 * -> idempotência -> instância -> opt-out/supressão -> janela de 24h do lead -> espaçamento/teto por minuto/dia (sob lock por instância) -> envio.
 * Relógio injetado (`opts.now`). Nada de texto, telefone ou token em log.
 */
export type ManualErrorCode =
  | "validation" | "message_too_long" | "not_found" | "forbidden" | "trial_expired" | "org_suspended" | "email_not_verified"
  | "instance_unavailable" | "opted_out" | "conversation_window_closed" | "rate_limited" | "send_failed";

export type SendManualResult =
  | { ok: true; message: MessageView; /** true = mesmo `clientMessageId` já enviado: devolve a existente, sem reenviar. */ duplicate: boolean }
  | { ok: false; code: ManualErrorCode; error: string; retryAfterSeconds?: number; /** Presente quando a falha ocorreu DEPOIS de gravar a bolha (status `failed`). */ message?: MessageView };

export interface SendManualInput { orgId: string; userId: string; conversationId: string; clientMessageId: string; text: string }
export interface SendManualOptions { now?: Date; provider?: WhatsAppProvider }

const no = (code: ManualErrorCode, error: string, retryAfterSeconds?: number): SendManualResult => ({ ok: false, code, error, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) });
const secondsUntil = (at: number, now: Date) => Math.max(1, Math.ceil((at - now.getTime()) / 1000));

export const MANUAL_MESSAGES = {
  tooLong: `A mensagem passa de ${MESSAGE_MAX_CHARS} caracteres.`,
  empty: "Escreva uma mensagem para enviar.",
  invalidChars: "A mensagem tem caracteres não permitidos.",
  notFound: "Conversa não encontrada.",
  forbidden: "Sem permissão.",
  trialExpired: "Seu teste grátis terminou. Assine um plano em Configurações > Assinatura para voltar de onde parou.",
  orgSuspended: "Assinatura pendente ou cancelada. Regularize o pagamento em Configurações > Assinatura para continuar.",
  emailNotVerified: "Confirme seu e-mail para enviar mensagens.",
  instanceUnavailable: "O WhatsApp desta conversa está desconectado ou pausado. Reconecte em Configurações > WhatsApp.",
  optedOut: "Este contato pediu para não receber mensagens. A resposta está bloqueada.",
  windowClosed: "Já se passaram mais de 24 horas desde a última mensagem deste contato. Só é possível responder dentro de 24 horas.",
  gap: "Aguarde alguns segundos antes de enviar outra mensagem.",
  perMinute: "Muitas mensagens em pouco tempo neste número. Aguarde um instante.",
  perDay: "O limite diário de envios deste número foi atingido. Tente amanhã.",
  failed: "Não foi possível enviar a mensagem pelo WhatsApp.",
} as const;

export async function sendManualWhatsApp(input: SendManualInput, opts: SendManualOptions = {}): Promise<SendManualResult> {
  const now = opts.now ?? new Date();
  const { orgId, userId, conversationId, clientMessageId } = input;

  // Texto (cheap, sem banco): trim, 1..4096, sem caracteres de controle.
  const text = input.text.trim();
  if (!UUID_RE.test(clientMessageId) || !UUID_RE.test(conversationId)) return no("validation", "Dados inválidos.");
  if (!text) return no("validation", MANUAL_MESSAGES.empty);
  if (text.length > MESSAGE_MAX_CHARS) return no("message_too_long", MANUAL_MESSAGES.tooLong);
  if (hasControlChars(text)) return no("validation", MANUAL_MESSAGES.invalidChars);

  // 1) Org (trial expirado / suspensa), papel (membro da org; platform_admin nunca é membro) e e-mail verificado.
  const [access, org, member, user] = await Promise.all([
    loadOrgAccess(prisma, orgId, now),
    prisma.organization.findUnique({ where: { id: orgId }, select: { status: true } }),
    prisma.membership.findUnique({ where: { userId_orgId: { userId, orgId } }, select: { orgRole: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true, role: true } }),
  ]);
  if (!member || !user || user.role === "platform_admin") return no("forbidden", MANUAL_MESSAGES.forbidden);
  if (access === null || !org) return no("not_found", MANUAL_MESSAGES.notFound);
  if (access === "trial_expirado") return no("trial_expired", MANUAL_MESSAGES.trialExpired);
  if (access === "soft_blocked" || org.status !== "active") return no("org_suspended", MANUAL_MESSAGES.orgSuspended);
  if (!user.emailVerifiedAt) return no("email_not_verified", MANUAL_MESSAGES.emailNotVerified);

  // 2) Conversa DA ORG (404 uniforme) + instância.
  const conv = await prisma.waConversation.findFirst({
    where: { id: conversationId, orgId },
    include: { lead: { select: { id: true, email: true, optedOutAt: true, sequenceStatus: true } }, whatsappInstance: true },
  });
  if (!conv) return no("not_found", MANUAL_MESSAGES.notFound);

  // 8) Idempotência (antes das demais guardas: reenvio de rede de algo já enviado devolve a existente, mesmo com a janela fechada depois).
  const dup = await findDuplicate(orgId, clientMessageId, conv.id);
  if (dup === "other") return no("validation", "Dados inválidos.");
  if (dup) return { ok: true, message: dup, duplicate: true };

  const instance = conv.whatsappInstance;
  if (instance.orgId !== orgId) return no("not_found", MANUAL_MESSAGES.notFound); // defesa em profundidade
  if (instance.status !== "connected" || instancePaused(instance, now)) return no("instance_unavailable", MANUAL_MESSAGES.instanceUnavailable);

  // 3) Opt-out / supressão: SEM override manual.
  if (conv.lead.optedOutAt || conv.lead.sequenceStatus === "opted_out" || (await findSuppression({ email: conv.lead.email, phone: conv.contactPhone }, orgId))) {
    return no("opted_out", MANUAL_MESSAGES.optedOut);
  }

  // 4) Janela de conversa (D-068-4): até 24h após a última mensagem do lead, qualquer dia/hora. Primeiro contato manual fica bloqueado no MVP.
  if (!conv.lastInboundAt || now.getTime() - conv.lastInboundAt.getTime() > CONVERSATION_WINDOW_MS) return no("conversation_window_closed", MANUAL_MESSAGES.windowClosed);

  // 5) Espaçamento + teto por minuto + teto diário, e reserva da bolha `sending`, tudo sob lock por instância (dois envios simultâneos não furam o limite).
  const reserved = await prisma.$transaction(async (tx): Promise<{ row: { id: string } } | { dup: MessageView } | { limited: SendManualResult }> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`inbox-send:${instance.id}`}))`;
    const again = await tx.waMessage.findUnique({ where: { orgId_clientMessageId: { orgId, clientMessageId } }, include: { sentBy: { select: { name: true } } } });
    if (again) return { dup: toMessageView(again) };

    const gapFrom = new Date(now.getTime() - MANUAL_MIN_GAP_MS);
    const [lastWa, lastTouch] = await Promise.all([
      tx.waMessage.findFirst({ where: { whatsappInstanceId: instance.id, direction: "outbound", origin: { in: ["manual", "automation"] }, messageAt: { gt: gapFrom, lte: now } }, orderBy: { messageAt: "desc" }, select: { messageAt: true } }),
      tx.touch.findFirst({ where: { whatsappInstanceId: instance.id, channel: "whatsapp", direction: "outbound", sentAt: { gt: gapFrom, lte: now } }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }),
    ]);
    const lastAt = Math.max(lastWa?.messageAt.getTime() ?? 0, lastTouch?.sentAt?.getTime() ?? 0);
    if (lastAt > 0) return { limited: no("rate_limited", MANUAL_MESSAGES.gap, secondsUntil(lastAt + MANUAL_MIN_GAP_MS, now)) };

    const minuteFrom = new Date(now.getTime() - 60_000);
    const inMinute = await tx.waMessage.findMany({
      where: { whatsappInstanceId: instance.id, origin: "manual", direction: "outbound", messageAt: { gt: minuteFrom, lte: now } },
      orderBy: { messageAt: "asc" }, take: MANUAL_MAX_PER_MINUTE, select: { messageAt: true },
    });
    if (inMinute.length >= MANUAL_MAX_PER_MINUTE) return { limited: no("rate_limited", MANUAL_MESSAGES.perMinute, secondsUntil(inMinute[0].messageAt.getTime() + 60_000, now)) };

    // Teto diário da instância (aquecimento SPEC-017 incluso): automáticos + manuais. O manual NÃO ultrapassa o teto; usa a reserva que o scheduler deixa livre.
    const since = startOfDaySP(now);
    const until = new Date(since.getTime() + 24 * 3600_000);
    const [autoToday, manualToday] = await Promise.all([
      tx.touch.count({ where: { whatsappInstanceId: instance.id, channel: "whatsapp", direction: "outbound", sentAt: { gte: since, lt: until } } }),
      tx.waMessage.count({ where: { whatsappInstanceId: instance.id, origin: "manual", direction: "outbound", status: { not: "failed" }, messageAt: { gte: since, lt: until } } }),
    ]);
    if (autoToday + manualToday >= effectiveDailyLimit(instance.dailyLimit, instance.warmupStartedAt, now, instance.health)) {
      return { limited: no("rate_limited", MANUAL_MESSAGES.perDay, secondsUntil(nextBrtDayStart(now).getTime(), now)) };
    }

    const row = await tx.waMessage.create({
      data: { orgId, conversationId: conv.id, whatsappInstanceId: instance.id, direction: "outbound", origin: "manual", kind: "text", body: text, clientMessageId, status: "sending", sentByUserId: userId, messageAt: now },
      select: { id: true },
    });
    return { row };
  }, { timeout: 10_000 }).catch((e: unknown) => {
    // Duplo clique simultâneo que escapou do lock (instâncias distintas não existem para a mesma conversa): P2002 = já criada.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "p2002" as const;
    throw e;
  });
  if (reserved === "p2002") {
    const d = await findDuplicate(orgId, clientMessageId, conv.id);
    return d && d !== "other" ? { ok: true, message: d, duplicate: true } : no("validation", "Dados inválidos.");
  }
  if ("dup" in reserved) return { ok: true, message: reserved.dup, duplicate: true };
  if ("limited" in reserved) return reserved.limited;

  // Envio: sendText NÃO é idempotente e SEM retry automático. Reenvio é ação explícita do usuário (novo clientMessageId).
  const messageId = reserved.row.id;
  let externalId: string | null = null;
  let failure: { error: string; retryAfterSeconds?: number } | null = null;
  try {
    const provider = opts.provider ?? getWhatsAppProvider(instance.orgId, instance.provider);
    externalId = (await provider.sendText({ instanceName: instance.instanceName, to: conv.contactPhone, text })).externalId;
  } catch (e) {
    const err = e instanceof AppError ? e : new AppError({ code: "unknown", userMessage: MANUAL_MESSAGES.failed, cause: e });
    console.error(`[inbox] resposta manual ${messageId} falhou: ${err.code}${err.status ? ` ${err.status}` : ""}`);
    failure = { error: sanitizeError(err.code === "timeout" ? TIMEOUT_WARNING : err.userMessage || MANUAL_MESSAGES.failed), ...(err.retryAfterSeconds ? { retryAfterSeconds: err.retryAfterSeconds } : {}) };
  }

  if (externalId) {
    await markSent(messageId, instance.id, externalId);
  } else {
    await prisma.waMessage.updateMany({ where: { id: messageId, status: "sending" }, data: { status: "failed", error: failure!.error } });
  }

  // Efeitos no funil (humano assumiu) — best effort: a mensagem já saiu/falhou; erro aqui não pode mudar o resultado do envio.
  try {
    await stopAgentOnManualReply(conv.lead.id, now);
    await prisma.agentRun.updateMany({ where: { leadId: conv.lead.id, status: "queued" }, data: { status: "skipped", error: "humano assumiu a conversa", processedAt: now } });
    await prisma.waConversation.updateMany({ where: { id: conv.id }, data: { status: "attending", unreadCount: 0 } });
    if (externalId) {
      await prisma.waConversation.updateMany({ where: { id: conv.id, lastMessageAt: { lte: now } }, data: { lastMessageAt: now, lastMessagePreview: buildPreview(text), lastMessageDirection: "outbound" } });
      await prisma.usageCounter.upsert({
        where: { orgId_metric_periodKey: { orgId, metric: MANUAL_REPLIES_METRIC, periodKey: monthKey(now) } },
        create: { orgId, metric: MANUAL_REPLIES_METRIC, periodKey: monthKey(now), count: 1 },
        update: { count: { increment: 1 } },
      });
      await recordOrgAudit(prisma, { orgId, actorUserId: userId, action: "inbox_manual_sent", meta: { conversationId: conv.id, messageId, kind: "text", length: text.length } });
    }
  } catch (e) {
    console.error(`[inbox] resposta manual ${messageId}: efeitos pós-envio falharam (ignorado):`, e instanceof AppError ? e.code : "erro");
  }

  const row = await prisma.waMessage.findUniqueOrThrow({ where: { id: messageId }, include: { sentBy: { select: { name: true } } } });
  const view = toMessageView(row);
  return failure ? { ok: false, code: "send_failed", error: failure.error, ...(failure.retryAfterSeconds ? { retryAfterSeconds: failure.retryAfterSeconds } : {}), message: view } : { ok: true, message: view, duplicate: false };
}

async function findDuplicate(orgId: string, clientMessageId: string, conversationId: string): Promise<MessageView | "other" | null> {
  const row = await prisma.waMessage.findUnique({ where: { orgId_clientMessageId: { orgId, clientMessageId } }, include: { sentBy: { select: { name: true } } } });
  if (!row) return null;
  return row.conversationId === conversationId ? toMessageView(row) : "other";
}

/** `sending` -> `sent` + externalId. Se o eco `fromMe` chegou primeiro e criou uma linha `device` com o mesmo id, ela é removida (não duplica a bolha). */
async function markSent(messageId: string, instanceId: string, externalId: string): Promise<void> {
  try {
    await prisma.waMessage.updateMany({ where: { id: messageId, status: "sending" }, data: { status: "sent", externalId } });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    await prisma.$transaction([
      prisma.waMessage.deleteMany({ where: { whatsappInstanceId: instanceId, externalId, origin: "device", id: { not: messageId } } }),
      prisma.waMessage.updateMany({ where: { id: messageId, status: "sending" }, data: { status: "sent", externalId } }),
    ]);
  }
}
