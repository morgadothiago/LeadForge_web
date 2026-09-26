import nodemailer, { type Transporter } from "nodemailer";
import type { EmailAccount } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto/secret-box";
import { AppError } from "@/lib/errors";
import { renderTemplate } from "@/lib/templates/render";
import { normalizeSmtpError } from "./smtp-errors";
import { buildUnsubscribeUrl } from "./unsubscribe";
import { findSuppression, SUPPRESSED_MESSAGE } from "@/lib/domain/suppression";
import { startOfLocalDay, startOfNextLocalDay } from "@/lib/whatsapp/send-window";
import { isCloserTouch, leadStopped, reservableWhere, repliedOrEnded, skipSuppressedBeforeReserve, skipSeedBeforeReserve, REPLIED_MESSAGE } from "./reserve";
import { resolvePublicHost, allowPrivateSmtpHosts, type HostResolver } from "./ssrf";

export { normalizeSmtpError };

const SP_OFFSET_MS = 3 * 3600_000; // America/Sao_Paulo = UTC-3 fixo (sem horário de verão desde 2019)
const SEND_HOUR_SP = 8;
const MAX_ERROR_LEN = 200;
/** Touch preso em `sending` há mais que isso (crash no meio do envio) pode ser reservado de novo. */
export const SENDING_STALE_MS = 15 * 60_000;

/** Início (UTC) do dia civil de America/Sao_Paulo que contém `now`. */
export function startOfDaySP(now: Date): Date {
  const sp = new Date(now.getTime() - SP_OFFSET_MS);
  return new Date(Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), sp.getUTCDate()) + SP_OFFSET_MS);
}
/** Próximo dia às 08:00 America/Sao_Paulo. */
export function nextSendWindow(now: Date): Date {
  return new Date(startOfDaySP(now).getTime() + 24 * 3600_000 + SEND_HOUR_SP * 3600_000);
}

export type PickResult =
  | { status: "ok"; account: EmailAccount }
  | { status: "deferred"; nextAt: Date }
  | { status: "no_account" };

/**
 * Escolhe conta ativa do usuário com capacidade no dia (Touches email `sent` da conta com sentAt >= início do dia SP < dailyLimit).
 * Rodízio justo: a conta com menos envios no dia; empate -> a menos recentemente usada. Não envia nada.
 */
export async function pickEmailAccount(userId: string, now: Date = new Date()): Promise<PickResult> {
  const accounts = await prisma.emailAccount.findMany({ where: { userId, isActive: true }, orderBy: { createdAt: "asc" } });
  if (!accounts.length) return { status: "no_account" };
  const since = startOfDaySP(now);
  const until = new Date(since.getTime() + 24 * 3600_000);
  const stats = await Promise.all(
    accounts.map(async (a) => {
      const [count, last] = await Promise.all([
        prisma.touch.count({ where: { emailAccountId: a.id, channel: "email", status: "sent", sentAt: { gte: since, lt: until } } }),
        prisma.touch.findFirst({ where: { emailAccountId: a.id, status: "sent" }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }),
      ]);
      return { a, count, last: last?.sentAt?.getTime() ?? 0 };
    }),
  );
  const open = stats.filter((s) => s.count < s.a.dailyLimit).sort((x, y) => x.count - y.count || x.last - y.last);
  if (!open.length) return { status: "deferred", nextAt: nextSendWindow(now) };
  return { status: "ok", account: open[0].a };
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
  /** Presente quando conectamos no IP já checado (anti-rebinding): o certificado é validado contra o host original. */
  tls?: { servername: string };
}
export interface SendEmailOptions {
  now?: Date;
  /** Testes: transport já pronto (jsonTransport/stream). A senha não é decifrada nesse caso. */
  transport?: Transporter;
  /** Testes: substitui nodemailer.createTransport; recebe a config com a senha decifrada. */
  createTransport?: (cfg: SmtpConfig) => Transporter;
  /** Testes: resolver DNS injetado para a checagem anti-SSRF. */
  resolveHost?: HostResolver;
}

export type SendEmailResult =
  | { status: "sent"; messageId: string; accountId: string }
  | { status: "already_sent" }
  | { status: "skipped"; reason: "opted_out" | "sequence_completed" | "replied" | "suppressed" | "seed_data" }
  | { status: "deferred"; nextAt: Date }
  | { status: "failed"; error: AppError };

export function sanitizeError(msg: string): string {
  return msg.replace(/\s+/g, " ").slice(0, MAX_ERROR_LEN);
}

export function smtpConfig(account: EmailAccount): SmtpConfig {
  return {
    host: account.smtpHost,
    port: account.port,
    secure: account.port === 465,
    auth: { user: account.email, pass: decrypt(account.encryptedPassword) },
  };
}

export const TIMEOUTS = { connectionTimeout: 8_000, greetingTimeout: 8_000, socketTimeout: 15_000 };

/** Resolve o host (bloqueando rede interna, SSRF) e conecta no IP checado. */
export async function buildTransport(account: EmailAccount, opts: Pick<SendEmailOptions, "createTransport" | "resolveHost"> = {}): Promise<Transporter> {
  let cfg = smtpConfig(account);
  const ip = await resolvePublicHost(cfg.host, opts.resolveHost);
  if (ip !== cfg.host && !allowPrivateSmtpHosts()) cfg = { ...cfg, host: ip, tls: { servername: account.smtpHost } };
  return opts.createTransport ? opts.createTransport(cfg) : nodemailer.createTransport({ ...cfg, ...TIMEOUTS });
}

async function fail(touchId: string, error: AppError): Promise<SendEmailResult> {
  console.error(`[email] touch ${touchId} falhou: ${error.code}${error.status ? ` ${error.status}` : ""}`);
  await prisma.touch.update({ where: { id: touchId }, data: { status: "failed", error: sanitizeError(error.userMessage) } });
  return { status: "failed", error };
}

/** Envia o Touch de e-mail. Idempotente (Touch já sent/delivered/replied não reenvia). Nunca lança por falha SMTP: devolve `failed`. */
export async function sendEmail(touchId: string, opts: SendEmailOptions = {}): Promise<SendEmailResult> {
  const now = opts.now ?? new Date();
  // SPEC-017: supressão ANTES de reservar.
  const where = reservableWhere(touchId, SENDING_STALE_MS);
  if (await skipSuppressedBeforeReserve(touchId, where)) return { status: "skipped", reason: "suppressed" };
  if (await skipSeedBeforeReserve(touchId, where)) return { status: "skipped", reason: "seed_data" };
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
    // Qualquer saída inesperada (exceção) não pode deixar o Touch preso em `sending`.
    if (!released) await prisma.touch.updateMany({ where: { id: touchId, status: "sending" }, data: { status: "failed", error: "Erro interno ao enviar." } });
  }
}

async function doSend(touchId: string, now: Date, opts: SendEmailOptions): Promise<SendEmailResult> {
  const touch = await prisma.touch.findUnique({
    where: { id: touchId },
    include: { lead: { include: { campaign: { select: { userId: true, orgId: true } } } }, step: { include: { template: true } } },
  });
  if (!touch) throw new AppError({ code: "not_found", userMessage: "Envio não encontrado." });
  if (touch.channel !== "email") return fail(touchId, new AppError({ code: "validation", userMessage: "Este envio não é do canal e-mail." }));

  const { lead } = touch;
  const skip = async (reason: "opted_out" | "sequence_completed" | "replied" | "suppressed" | "seed_data"): Promise<SendEmailResult> => {
    await prisma.touch.update({ where: { id: touchId }, data: { status: "skipped", ...(reason === "suppressed" ? { error: SUPPRESSED_MESSAGE } : reason === "replied" ? { error: REPLIED_MESSAGE } : {}) } });
    return { status: "skipped", reason };
  };
  if (lead.optedOutAt || lead.sequenceStatus === "opted_out") return skip("opted_out");
  if (lead.sequenceStatus === "completed") return skip("sequence_completed");
  const closerBypass = await isCloserTouch(touch);
  if (repliedOrEnded(lead, touch.createdAt, closerBypass)) return skip("replied");
  // SPEC-017: supressão global (e-mail ou telefone) antes de reservar conta/transport.
  if (await findSuppression({ email: lead.email, phone: lead.phone }, lead.campaign.orgId)) return skip("suppressed");

  if (!lead.email) return fail(touchId, new AppError({ code: "validation", userMessage: "O lead não possui e-mail." }));
  const template = touch.step?.template;
  let subject: { ok: true; text: string } | { ok: false; unknown: string[] };
  let body: { ok: true; text: string } | { ok: false; unknown: string[] };
  if (touch.agentGenerated && touch.content) {
    // SPEC-019: texto do agente (rascunho aprovado/autorizado); toda a política abaixo continua valendo.
    subject = { ok: true, text: touch.subject ?? "Contato" };
    body = { ok: true, text: touch.content };
  } else {
    if (!template) return fail(touchId, new AppError({ code: "not_found", userMessage: "Template do passo não encontrado." }));
    const vars = { name: lead.name, firstName: lead.name.trim().split(/\s+/)[0], company: lead.company, email: lead.email, phone: lead.phone, website: lead.website };
    subject = renderTemplate(template.subject ?? "", vars, { channel: "email", field: "subject" });
    body = renderTemplate(template.body, vars, { channel: "email", field: "body" });
  }
  if (!subject.ok || !body.ok) {
    const unk = [...(!subject.ok ? subject.unknown : []), ...(!body.ok ? body.unknown : [])];
    return fail(touchId, new AppError({ code: "validation", userMessage: `Template com variável desconhecida: ${unk.map((u) => `{{${u}}}`).join(", ")}.` }));
  }

  // SPEC-017: nunca dois canais no mesmo dia (dia local do lead): se já houve WhatsApp hoje, adia para amanhã.
  const otherToday = await prisma.touch.count({
    where: { leadId: lead.id, channel: { not: "email" }, direction: "outbound", sentAt: { gte: startOfLocalDay(lead.timezone, now), lt: startOfNextLocalDay(lead.timezone, now) } },
  });
  if (otherToday > 0) {
    const nextAt = nextSendWindow(now);
    await prisma.touch.update({ where: { id: touchId }, data: { status: "scheduled", scheduledAt: nextAt } });
    return { status: "deferred", nextAt };
  }

  const pick = await pickEmailAccount(lead.campaign.userId, now);
  if (pick.status === "no_account") return fail(touchId, new AppError({ code: "config", userMessage: "Nenhuma conta de e-mail ativa configurada." }));
  if (pick.status === "deferred") {
    await prisma.touch.update({ where: { id: touchId }, data: { status: "scheduled", scheduledAt: pick.nextAt } });
    return { status: "deferred", nextAt: pick.nextAt };
  }
  const account = pick.account;

  const url = buildUnsubscribeUrl(lead.id, now);
  const text = `${body.text}\n\n--\nPara não receber mais e-mails, descadastre-se: ${url}`;
  // Última checagem: o lead pode ter respondido entre a reserva e o envio (relê do banco; SMTP NÃO é chamado).
  if (await leadStopped(lead.id, touch.createdAt, closerBypass)) return skip("replied");
  try {
    const transport = opts.transport ?? (await buildTransport(account, opts));
    const info = (await transport.sendMail({
      from: account.fromName ? { name: account.fromName, address: account.email } : account.email,
      to: lead.email,
      subject: subject.text,
      text,
      headers: { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    })) as { messageId?: string };
    const messageId = info.messageId ?? "";
    await prisma.touch.update({
      where: { id: touchId },
      data: { status: "sent", sentAt: now, externalId: messageId || null, error: null, emailAccountId: account.id, content: body.text },
    });
    return { status: "sent", messageId, accountId: account.id };
  } catch (e) {
    return fail(touchId, normalizeSmtpError(e));
  }
}
