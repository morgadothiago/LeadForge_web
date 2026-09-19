import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { normalizeBrPhone } from "@/lib/domain/phone";
import { renderTemplate } from "@/lib/templates/render";
import { getWhatsAppProvider, type WhatsAppProvider } from "@/lib/whatsapp/provider";
import { earliestInWindow, isWithinSendWindow, nextWindowStart, startOfLocalDay, startOfNextLocalDay } from "@/lib/whatsapp/send-window";
import { nextAllowedSendAt } from "@/lib/whatsapp/rate";
import { findSuppression, SUPPRESSED_MESSAGE } from "@/lib/domain/suppression";
import { expandSpintax } from "@/lib/templates/spintax";
import { effectiveDailyLimit } from "@/lib/whatsapp/warmup";
import { ensureWarmupStarted, evaluateInstanceHealth, resumeInstanceNow } from "@/lib/whatsapp/health";
import { leadStopped, reservableWhere, repliedOrEnded, skipSuppressedBeforeReserve, REPLIED_MESSAGE, NEEDS_REVIEW_PREFIX } from "./reserve";
import { nextSendWindow, sanitizeError, SENDING_STALE_MS, startOfDaySP } from "./email";

const NOT_CONNECTED_RETRY_MS = 5 * 60_000;
const MIN_RATE_LIMIT_WAIT_S = 60;
const CHECK_RETRY_MS = 15 * 60_000;
const DAY_MS = 24 * 3600_000;
/** SPEC-017: no máximo 3 toques de WhatsApp por lead em 14 dias, com mínimo de 3 dias entre eles. */
export const MAX_TOUCHES_PER_LEAD = 3;
export const TOUCH_WINDOW_DAYS = 14;
export const MIN_DAYS_BETWEEN_TOUCHES = 3;
export const SKIP_MESSAGES = {
  suppressed: SUPPRESSED_MESSAGE,
  touch_limit: "limite de toques",
  no_whatsapp: "número sem WhatsApp",
} as const;
export { NEEDS_REVIEW_PREFIX };
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
  | { status: "skipped"; reason: "opted_out" | "sequence_completed" | "replied" | "suppressed" | "touch_limit" | "no_whatsapp" }
  | {
      status: "deferred";
      nextAt: Date;
      reason: "outside_window" | "daily_limit" | "not_connected" | "min_interval" | "rate_limited" | "min_gap" | "other_channel_today" | "instance_paused" | "number_check_failed";
    }
  | { status: "failed"; error: AppError };

async function fail(touchId: string, error: AppError, message?: string, instanceId?: string): Promise<SendWhatsAppResult> {
  console.error(`[whatsapp] touch ${touchId} falhou: ${error.code}${error.status ? ` ${error.status}` : ""}`);
  await prisma.touch.update({
    where: { id: touchId },
    data: { status: "failed", error: sanitizeError(message ?? error.userMessage), ...(instanceId ? { whatsappInstanceId: instanceId } : {}) },
  });
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
  // SPEC-017: supressão ANTES de reservar (Touch suprimido nunca passa por `sending`). Falha `timeout` exige revisão humana (retryTouch).
  const where = reservableWhere(touchId, SENDING_STALE_MS, false);
  if (await skipSuppressedBeforeReserve(touchId, where)) return { status: "skipped", reason: "suppressed" };
  const reserved = await prisma.touch.updateMany({ where, data: { status: "sending" } });
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
  const skip = async (reason: Extract<SendWhatsAppResult, { status: "skipped" }>["reason"]): Promise<SendWhatsAppResult> => {
    const msg = reason === "replied" ? REPLIED_MESSAGE : reason in SKIP_MESSAGES ? SKIP_MESSAGES[reason as keyof typeof SKIP_MESSAGES] : null;
    await prisma.touch.update({ where: { id: touchId }, data: { status: "skipped", ...(msg ? { error: msg } : {}) } });
    return { status: "skipped", reason };
  };
  if (lead.optedOutAt || lead.sequenceStatus === "opted_out") return skip("opted_out");
  if (lead.sequenceStatus === "completed") return skip("sequence_completed");
  if (repliedOrEnded(lead, touch.createdAt)) return skip("replied");
  // SPEC-017: supressão global ANTES de qualquer outra coisa (provider nunca é chamado).
  if (await findSuppression({ email: lead.email, phone: lead.phone })) return skip("suppressed");

  const phone = lead.phone ? normalizeBrPhone(lead.phone) : null;
  if (!phone || !phone.ok) return fail(touchId, new AppError({ code: "validation", userMessage: "O lead não possui telefone válido (celular brasileiro)." }));
  const template = touch.step?.template;
  if (!template) return fail(touchId, new AppError({ code: "not_found", userMessage: "Template do passo não encontrado." }));

  const vars = { name: lead.name, firstName: lead.name.trim().split(/\s+/)[0], company: lead.company, email: lead.email, phone: lead.phone, website: lead.website };
  // Variação de texto determinística por lead+passo (spintax) antes das variáveis {{x}}.
  const raw = expandSpintax(template.body, `${lead.id}:${touch.stepId ?? touch.id}`);
  const body = renderTemplate(raw, vars, { channel: "whatsapp", field: "body" });
  if (!body.ok) return fail(touchId, new AppError({ code: "validation", userMessage: `Template com variável desconhecida: ${body.unknown.map((u) => `{{${u}}}`).join(", ")}.` }));

  // Cadência gentil: 3 toques / 14 dias, mínimo 3 dias entre toques.
  const prior = await prisma.touch.findMany({
    where: { leadId: lead.id, channel: "whatsapp", direction: "outbound", id: { not: touchId }, sentAt: { not: null, gte: new Date(now.getTime() - TOUCH_WINDOW_DAYS * DAY_MS) } },
    orderBy: { sentAt: "desc" }, select: { sentAt: true },
  });
  if (prior.length >= MAX_TOUCHES_PER_LEAD) return skip("touch_limit");
  if (prior[0]?.sentAt) {
    const gapEnd = new Date(prior[0].sentAt.getTime() + MIN_DAYS_BETWEEN_TOUCHES * DAY_MS);
    if (gapEnd.getTime() > now.getTime()) return defer(touchId, earliestInWindow(lead.timezone, gapEnd), "min_gap");
  }
  // Nunca dois canais no mesmo dia (dia local do lead): adia o segundo para o próximo dia útil/janela.
  const otherToday = await prisma.touch.count({
    where: { leadId: lead.id, channel: { not: "whatsapp" }, direction: "outbound", sentAt: { gte: startOfLocalDay(lead.timezone, now), lt: startOfNextLocalDay(lead.timezone, now) } },
  });
  if (otherToday > 0) return defer(touchId, earliestInWindow(lead.timezone, startOfNextLocalDay(lead.timezone, now)), "other_channel_today");

  // Janela seg-sex 9-12/14-17 no fuso do lead, sem feriados nacionais: NÃO chama a API; reagenda.
  if (!isWithinSendWindow(lead.timezone, now)) return defer(touchId, nextWindowStart(lead.timezone, now), "outside_window");

  const instanceId = lead.campaign.whatsappInstanceId;
  let instance = instanceId ? await prisma.whatsAppInstance.findUnique({ where: { id: instanceId } }) : null;
  if (!instance) return fail(touchId, new AppError({ code: "config", userMessage: "A campanha não tem instância de WhatsApp vinculada." }));

  if (instance.status !== "connected") {
    return defer(touchId, new Date(now.getTime() + NOT_CONNECTED_RETRY_MS), "not_connected", "Instância de WhatsApp desconectada. Reconecte para retomar os envios.");
  }
  // Disjuntor: paused mantém o Touch agendado até pausedUntil; vencido = retomada automática com rampa reduzida.
  if (instance.health === "paused") {
    if (instance.pausedUntil && instance.pausedUntil.getTime() > now.getTime()) {
      return defer(touchId, earliestInWindow(lead.timezone, instance.pausedUntil), "instance_paused", `Instância pausada: ${instance.pausedReason ?? "saúde"}.`);
    }
    await resumeInstanceNow(instance.id, now, "auto");
    instance = await prisma.whatsAppInstance.findUniqueOrThrow({ where: { id: instance.id } });
  }
  if (!instance.warmupStartedAt) {
    await ensureWarmupStarted(instance.id, now);
    instance = { ...instance, warmupStartedAt: now };
  }

  const provider = opts.provider ?? getWhatsAppProvider(instance.provider);

  // Verificar número (1º envio, cacheado): sem WhatsApp = skipped; falha da checagem = deferred, nunca envia às cegas.
  if (lead.hasWhatsapp === false) return skip("no_whatsapp");
  if (lead.hasWhatsapp === null) {
    try {
      const [res] = await provider.checkNumbers(instance.instanceName, [phone.e164]);
      if (!res) throw new AppError({ code: "upstream", userMessage: "Verificação de número sem resposta." });
      await prisma.lead.update({ where: { id: lead.id }, data: { hasWhatsapp: res.exists, whatsappCheckedAt: now } });
      if (!res.exists) return skip("no_whatsapp");
    } catch (e) {
      const err = e instanceof AppError ? e : new AppError({ code: "unknown", userMessage: "Falha ao verificar o número no WhatsApp.", cause: e });
      const wait = err.code === "rate_limited" ? Math.max((err.retryAfterSeconds ?? 0) * 1000, CHECK_RETRY_MS) : CHECK_RETRY_MS;
      return defer(touchId, earliestInWindow(lead.timezone, new Date(now.getTime() + wait)), "number_check_failed", err.userMessage);
    }
  }

  const since = startOfDaySP(now);
  const [count, recent] = await Promise.all([
    prisma.touch.count({ where: { whatsappInstanceId: instance.id, channel: "whatsapp", direction: "outbound", sentAt: { gte: since, lt: new Date(since.getTime() + DAY_MS) } } }),
    prisma.touch.findMany({
      where: { whatsappInstanceId: instance.id, channel: "whatsapp", direction: "outbound", sentAt: { not: null, gte: new Date(now.getTime() - 3600_000) } },
      orderBy: { sentAt: "desc" }, take: 6, select: { sentAt: true },
    }),
  ]);
  // Aquecimento: efetivo = min(teto, rampa por idade da instância); excedente vai para o dia seguinte.
  if (count >= effectiveDailyLimit(instance.dailyLimit, instance.warmupStartedAt, now, instance.health)) {
    return defer(touchId, earliestInWindow(lead.timezone, nextSendWindow(now)), "daily_limit", "Limite diário da instância atingido; reagendado.");
  }

  const allowedAt = nextAllowedSendAt(recent.map((r) => r.sentAt!), now, opts.rng);
  if (allowedAt.getTime() > now.getTime()) return defer(touchId, earliestInWindow(lead.timezone, allowedAt), "min_interval");

  // Última checagem: inbound pode ter chegado entre a reserva e o envio. Relê o lead do banco; provider NÃO é chamado.
  if (await leadStopped(lead.id, touch.createdAt)) return skip("replied");

  try {
    const res = await provider.sendText({ instanceName: instance.instanceName, to: phone.e164, text: body.text });
    await prisma.touch.update({
      where: { id: touchId },
      data: { status: "sent", sentAt: now, externalId: res.externalId, error: null, whatsappInstanceId: instance.id, content: body.text },
    });
    await evaluateInstanceHealth(instance.id, now);
    return { status: "sent", externalId: res.externalId, instanceId: instance.id };
  } catch (e) {
    const err = e instanceof AppError ? e : new AppError({ code: "unknown", userMessage: "Falha inesperada ao enviar pelo WhatsApp.", cause: e });
    if (err.code === "rate_limited") {
      const wait = Math.max(err.retryAfterSeconds ?? 0, MIN_RATE_LIMIT_WAIT_S);
      return defer(touchId, earliestInWindow(lead.timezone, new Date(now.getTime() + wait * 1000)), "rate_limited", err.userMessage);
    }
    // Timeout em POST não idempotente: a mensagem pode ter saído. Não reenviar sem checagem humana.
    const failed = err.code === "timeout" ? await fail(touchId, err, TIMEOUT_WARNING, instance.id) : await fail(touchId, err, undefined, instance.id);
    await evaluateInstanceHealth(instance.id, now);
    return failed;
  }
}
