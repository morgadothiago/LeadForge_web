import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { normalizeBrPhone } from "@/lib/domain/phone";
import { renderTemplate } from "@/lib/templates/render";
import { getWhatsAppProvider, type WhatsAppProvider } from "@/lib/whatsapp/provider";
import { earliestInWindow, isWithinSendWindow, nextWindowStart } from "@/lib/whatsapp/send-window";
import { nextAllowedSendAt } from "@/lib/whatsapp/rate";
import { nextSendWindow, sanitizeError, SENDING_STALE_MS, startOfDaySP } from "./email";

const NOT_CONNECTED_RETRY_MS = 5 * 60_000;
const MIN_RATE_LIMIT_WAIT_S = 60;
export const TIMEOUT_WARNING = "Não foi possível confirmar o envio; verifique no WhatsApp antes de reenviar.";

export interface SendWhatsAppOptions {
  now?: Date;
  /** Testes: provider injetado (default: getWhatsAppProvider(instance.provider)). */
  provider?: WhatsAppProvider;
  rng?: () => number;
}

export type SendWhatsAppResult =
  | { status: "sent"; externalId: string; instanceId: string }
  | { status: "already_sent" }
  | { status: "skipped"; reason: "opted_out" | "sequence_completed" }
  | { status: "deferred"; nextAt: Date; reason: "outside_window" | "daily_limit" | "not_connected" | "min_interval" | "rate_limited" }
  | { status: "failed"; error: AppError };

async function fail(touchId: string, error: AppError, message?: string): Promise<SendWhatsAppResult> {
  console.error(`[whatsapp] touch ${touchId} falhou: ${error.code}${error.status ? ` ${error.status}` : ""}`);
  await prisma.touch.update({ where: { id: touchId }, data: { status: "failed", error: sanitizeError(message ?? error.userMessage) } });
  return { status: "failed", error };
}
async function defer(touchId: string, nextAt: Date, reason: Extract<SendWhatsAppResult, { status: "deferred" }>["reason"], error: string | null = null): Promise<SendWhatsAppResult> {
  await prisma.touch.update({ where: { id: touchId }, data: { status: "scheduled", scheduledAt: nextAt, error: error ? sanitizeError(error) : null } });
  return { status: "deferred", nextAt, reason };
}

/**
 * Envia o Touch de WhatsApp. Idempotente (Touch sent/delivered/replied não reenvia). Nunca lança por falha do provider.
 * O scheduler (SPEC-013) deve serializar por instância; a reserva atômica só protege o MESMO Touch.
 */
export async function sendWhatsApp(touchId: string, opts: SendWhatsAppOptions = {}): Promise<SendWhatsAppResult> {
  const now = opts.now ?? new Date();
  const reserved = await prisma.touch.updateMany({
    where: {
      id: touchId,
      OR: [
        { status: { in: ["pending", "scheduled", "failed"] } },
        { status: "sending", updatedAt: { lt: new Date(Date.now() - SENDING_STALE_MS) } },
      ],
    },
    data: { status: "sending" },
  });
  if (reserved.count === 0) {
    const cur = await prisma.touch.findUnique({ where: { id: touchId }, select: { status: true } });
    if (!cur) throw new AppError({ code: "not_found", userMessage: "Envio não encontrado." });
    return { status: "already_sent" };
  }
  let released = false;
  try {
    const r = await doSend(touchId, now, opts);
    released = true;
    return r;
  } finally {
    if (!released) await prisma.touch.updateMany({ where: { id: touchId, status: "sending" }, data: { status: "failed", error: "Erro interno ao enviar." } });
  }
}

async function doSend(touchId: string, now: Date, opts: SendWhatsAppOptions): Promise<SendWhatsAppResult> {
  const touch = await prisma.touch.findUnique({
    where: { id: touchId },
    include: { lead: { include: { campaign: { select: { whatsappInstanceId: true } } } }, step: { include: { template: true } } },
  });
  if (!touch) throw new AppError({ code: "not_found", userMessage: "Envio não encontrado." });
  if (touch.channel !== "whatsapp") return fail(touchId, new AppError({ code: "validation", userMessage: "Este envio não é do canal WhatsApp." }));

  const { lead } = touch;
  const skip = async (reason: "opted_out" | "sequence_completed"): Promise<SendWhatsAppResult> => {
    await prisma.touch.update({ where: { id: touchId }, data: { status: "skipped" } });
    return { status: "skipped", reason };
  };
  if (lead.optedOutAt || lead.sequenceStatus === "opted_out") return skip("opted_out");
  if (lead.sequenceStatus === "completed") return skip("sequence_completed");

  const phone = lead.phone ? normalizeBrPhone(lead.phone) : null;
  if (!phone || !phone.ok) return fail(touchId, new AppError({ code: "validation", userMessage: "O lead não possui telefone válido (celular brasileiro)." }));
  const template = touch.step?.template;
  if (!template) return fail(touchId, new AppError({ code: "not_found", userMessage: "Template do passo não encontrado." }));

  const vars = { name: lead.name, firstName: lead.name.trim().split(/\s+/)[0], company: lead.company, email: lead.email, phone: lead.phone, website: lead.website };
  const body = renderTemplate(template.body, vars, { channel: "whatsapp", field: "body" });
  if (!body.ok) return fail(touchId, new AppError({ code: "validation", userMessage: `Template com variável desconhecida: ${body.unknown.map((u) => `{{${u}}}`).join(", ")}.` }));

  // Fora da janela 8h-18h do lead: NÃO chama a API; reagenda.
  if (!isWithinSendWindow(lead.timezone, now)) return defer(touchId, nextWindowStart(lead.timezone, now), "outside_window");

  const instanceId = lead.campaign.whatsappInstanceId;
  const instance = instanceId ? await prisma.whatsAppInstance.findUnique({ where: { id: instanceId } }) : null;
  if (!instance) return fail(touchId, new AppError({ code: "config", userMessage: "A campanha não tem instância de WhatsApp vinculada." }));

  if (instance.status !== "connected") {
    return defer(touchId, new Date(now.getTime() + NOT_CONNECTED_RETRY_MS), "not_connected", "Instância de WhatsApp desconectada. Reconecte para retomar os envios.");
  }

  const since = startOfDaySP(now);
  const [count, last] = await Promise.all([
    prisma.touch.count({ where: { whatsappInstanceId: instance.id, channel: "whatsapp", status: "sent", sentAt: { gte: since, lt: new Date(since.getTime() + 24 * 3600_000) } } }),
    prisma.touch.findFirst({ where: { whatsappInstanceId: instance.id, status: "sent" }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }),
  ]);
  if (count >= instance.dailyLimit) return defer(touchId, earliestInWindow(lead.timezone, nextSendWindow(now)), "daily_limit", "Limite diário da instância atingido; reagendado.");

  const allowedAt = nextAllowedSendAt(last?.sentAt, now, opts.rng);
  if (allowedAt.getTime() > now.getTime()) return defer(touchId, allowedAt, "min_interval");

  try {
    const provider = opts.provider ?? getWhatsAppProvider(instance.provider);
    const res = await provider.sendText({ instanceName: instance.instanceName, to: phone.e164, text: body.text });
    await prisma.touch.update({
      where: { id: touchId },
      data: { status: "sent", sentAt: now, externalId: res.externalId, error: null, whatsappInstanceId: instance.id, content: body.text },
    });
    return { status: "sent", externalId: res.externalId, instanceId: instance.id };
  } catch (e) {
    const err = e instanceof AppError ? e : new AppError({ code: "unknown", userMessage: "Falha inesperada ao enviar pelo WhatsApp.", cause: e });
    if (err.code === "rate_limited") {
      const wait = Math.max(err.retryAfterSeconds ?? 0, MIN_RATE_LIMIT_WAIT_S);
      return defer(touchId, earliestInWindow(lead.timezone, new Date(now.getTime() + wait * 1000)), "rate_limited", err.userMessage);
    }
    // Timeout em POST não idempotente: a mensagem pode ter saído. Não reenviar sem checagem humana.
    if (err.code === "timeout") return fail(touchId, err, TIMEOUT_WARNING);
    return fail(touchId, err);
  }
}
