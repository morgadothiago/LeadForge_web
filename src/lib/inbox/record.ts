import { Prisma, type PrismaClient } from "@prisma/client";
import { pickLead } from "@/lib/domain/whatsapp-inbound";
import { ECHO_ADOPT_WINDOW_MS, MESSAGE_MAX_CHARS } from "./constants";
import { buildPreview } from "./text";

/**
 * SPEC-068a (D-068-2) — gravação da caixa (WaConversation/WaMessage). O `Touch` segue sendo o motor da sequência; nada aqui altera pausa,
 * opt-out, estágio ou Closer. Idempotência por `(whatsappInstanceId, externalId)` via `createMany({ skipDuplicates })` (ON CONFLICT DO NOTHING:
 * não aborta a transação do webhook). Nenhuma função loga texto, telefone ou token.
 */
type Db = Prisma.TransactionClient | PrismaClient;
export interface InstanceRef { id: string; orgId: string }

/** Cria (ou reaproveita) a conversa da instância+número. `leadId` é reatribuído ao lead resolvido agora (Q-068-9). */
export async function ensureConversation(db: Db, instance: InstanceRef, leadId: string, phone: string, at: Date) {
  return db.waConversation.upsert({
    where: { whatsappInstanceId_contactPhone: { whatsappInstanceId: instance.id, contactPhone: phone } },
    create: { orgId: instance.orgId, whatsappInstanceId: instance.id, leadId, contactPhone: phone, lastMessageAt: at },
    update: { leadId },
  });
}

/** Atualiza prévia/horário só se a mensagem não for mais antiga que a atual (mensagens fora de ordem não regridem a lista). */
async function bumpLast(db: Db, conversationId: string, at: Date, preview: string | null, direction: "inbound" | "outbound"): Promise<void> {
  await db.waConversation.updateMany({
    where: { id: conversationId, lastMessageAt: { lte: at } },
    data: { lastMessageAt: at, lastMessagePreview: preview, lastMessageDirection: direction },
  });
}

/** Recebida do lead. Reentrega (mesmo externalId) NÃO duplica e NÃO incrementa não lidas. */
export async function recordInboundMessage(
  db: Db, instance: InstanceRef, leadId: string, ev: { from: string; text: string; externalId: string; timestamp: Date }, now: Date,
): Promise<"created" | "duplicate"> {
  const at = ev.timestamp.getTime() > now.getTime() ? now : ev.timestamp;
  const conv = await ensureConversation(db, instance, leadId, ev.from, at);
  const created = await db.waMessage.createMany({
    data: [{
      orgId: instance.orgId, conversationId: conv.id, whatsappInstanceId: instance.id, direction: "inbound", origin: "lead", kind: "text",
      body: ev.text.slice(0, MESSAGE_MAX_CHARS), externalId: ev.externalId, status: "delivered", messageAt: at,
    }],
    skipDuplicates: true,
  });
  if (created.count === 0) return "duplicate";
  await bumpLast(db, conv.id, at, buildPreview(ev.text), "inbound");
  await db.waConversation.updateMany({ where: { id: conv.id, OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: at } }] }, data: { lastInboundAt: at } });
  // Lead voltou a escrever: reabre como "Aguardando" (closed/attending -> waiting) e soma 1 não lida.
  await db.waConversation.update({ where: { id: conv.id }, data: { status: "waiting", unreadCount: { increment: 1 } } });
  return "created";
}

/** Escolhe o lead do telefone na org da instância (mesmo ranking do `processInbound`, que permanece intacto). */
export async function resolveLeadId(db: Db, instance: InstanceRef, phone: string): Promise<string | null> {
  const rows = await db.lead.findMany({
    where: { phone, campaign: { orgId: instance.orgId } },
    select: {
      id: true, createdAt: true, sequenceStatus: true,
      campaign: { select: { whatsappInstanceId: true } },
      touches: { where: { direction: "outbound", channel: "whatsapp", whatsappInstanceId: instance.id, sentAt: { not: null } }, orderBy: { sentAt: "desc" }, take: 1, select: { sentAt: true } },
    },
  });
  const lead = pickLead(rows.map((r) => ({ ...r, campaignInstanceId: r.campaign.whatsappInstanceId, lastSentByInstance: r.touches[0]?.sentAt ?? null })), instance.id);
  return lead?.id ?? null;
}

export type EchoOutcome = "known" | "adopted" | "device" | "lead_not_found";

/**
 * Eco `fromMe` (D-068-2). Já existe por externalId -> só confirma. Senão, "adota" a mensagem manual em `sending` (o eco pode chegar antes da
 * resposta do `sendText`); senão grava `origin=device`, `status=sent` (sem consumir limite). Número sem lead -> ignorado (Q-068-9).
 */
export async function recordOutboundEcho(
  db: Db, instance: InstanceRef, ev: { to: string; text: string; externalId: string; timestamp: Date }, now: Date,
): Promise<EchoOutcome> {
  const known = await db.waMessage.findUnique({ where: { whatsappInstanceId_externalId: { whatsappInstanceId: instance.id, externalId: ev.externalId } }, select: { id: true } });
  if (known) return "known";
  const at = ev.timestamp.getTime() > now.getTime() ? now : ev.timestamp;
  let conv = await db.waConversation.findUnique({ where: { whatsappInstanceId_contactPhone: { whatsappInstanceId: instance.id, contactPhone: ev.to } } });
  if (!conv) {
    const leadId = await resolveLeadId(db, instance, ev.to);
    if (!leadId) return "lead_not_found";
    conv = await ensureConversation(db, instance, leadId, ev.to, at);
  }
  const pending = await db.waMessage.findFirst({
    where: {
      conversationId: conv.id, orgId: instance.orgId, direction: "outbound", origin: "manual", status: { in: ["sending", "failed"] }, externalId: null,
      body: ev.text, createdAt: { gte: new Date(now.getTime() - ECHO_ADOPT_WINDOW_MS) },
    },
    orderBy: { createdAt: "asc" }, select: { id: true },
  });
  if (pending) {
    // `failed` sem externalId = timeout incerto (a mensagem pode ter saído): o eco prova que saiu, então promove a `sent`.
    const r = await db.waMessage.updateMany({ where: { id: pending.id, externalId: null, status: { in: ["sending", "failed"] } }, data: { externalId: ev.externalId, status: "sent", error: null } });
    if (r.count > 0) return "adopted";
  }
  const created = await db.waMessage.createMany({
    data: [{
      orgId: instance.orgId, conversationId: conv.id, whatsappInstanceId: instance.id, direction: "outbound", origin: "device", kind: "text",
      body: ev.text.slice(0, MESSAGE_MAX_CHARS), externalId: ev.externalId, status: "sent", messageAt: at,
    }],
    skipDuplicates: true,
  });
  if (created.count === 0) return "known";
  await bumpLast(db, conv.id, at, buildPreview(ev.text), "outbound");
  // Humano respondeu pelo celular: "Aguardando" -> "Atendendo". Não mexe em não lidas nem reabre conversa encerrada.
  // Eco de mensagem AUTOMÁTICA que chegou antes do Touch/recordAutomationMessage não é humano: não promove (recordAutomationMessage também reverte).
  const isAutomation = await db.touch.findFirst({ where: { whatsappInstanceId: instance.id, externalId: ev.externalId, direction: "outbound" }, select: { id: true } });
  if (!isAutomation) await db.waConversation.updateMany({ where: { id: conv.id, status: "waiting" }, data: { status: "attending" } });
  return "device";
}

/**
 * Mensagem automática da sequência, gravada DEPOIS do update do Touch e FORA da transação dele (falha daqui nunca desfaz/reenvia o envio).
 * Se o eco `fromMe` chegou primeiro (linha `device`), promove a linha a `automation` ligada ao Touch.
 */
export async function recordAutomationMessage(
  db: PrismaClient, instance: InstanceRef, p: { leadId: string; phone: string; touchId: string; text: string; externalId: string; at: Date },
): Promise<void> {
  const conv = await ensureConversation(db, instance, p.leadId, p.phone, p.at);
  const created = await db.waMessage.createMany({
    data: [{
      orgId: instance.orgId, conversationId: conv.id, whatsappInstanceId: instance.id, direction: "outbound", origin: "automation", kind: "text",
      body: p.text.slice(0, MESSAGE_MAX_CHARS), externalId: p.externalId, status: "sent", touchId: p.touchId, messageAt: p.at,
    }],
    skipDuplicates: true,
  });
  if (created.count === 0) {
    const promoted = await db.waMessage.updateMany({
      where: { whatsappInstanceId: instance.id, externalId: p.externalId, origin: "device" },
      data: { origin: "automation", touchId: p.touchId },
    });
    // O eco chegou antes e (se o Touch ainda não existia) pode ter marcado "atendendo": sem humano na conversa, volta a "aguardando".
    if (promoted.count > 0 && !(await db.waMessage.findFirst({ where: { conversationId: conv.id, direction: "outbound", origin: { in: ["manual", "device"] } }, select: { id: true } }))) {
      await db.waConversation.updateMany({ where: { id: conv.id, status: "attending" }, data: { status: "waiting" } });
    }
  }
  await bumpLast(db, conv.id, p.at, buildPreview(p.text), "outbound");
}
