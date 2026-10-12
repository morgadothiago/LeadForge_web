import type { PrismaClient, TouchStatus, WaMessageStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeBrPhone } from "@/lib/domain/phone";
import { MESSAGE_MAX_CHARS } from "./constants";
import { buildPreview } from "./text";

/**
 * SPEC-068a (Q-068-8) — backfill IDEMPOTENTE do histórico anterior à caixa: `Touch` de WhatsApp com `externalId` (enviado/recebido) vira `WaMessage`
 * (chave = `(whatsappInstanceId, externalId)`; reexecutar não duplica). Touch nunca enviado (sem `externalId`: pending/scheduled/skipped) NÃO vira mensagem.
 * Fora da migration. Não mexe em `unreadCount` nem em `status` de conversa que já existe; conversa nova nasce com 0 não lidas.
 */
export interface BackfillResult { scanned: number; messagesCreated: number; conversationsTouched: number; skipped: number }

const STATUS: Partial<Record<TouchStatus, WaMessageStatus>> = { sent: "sent", sending: "sent", delivered: "delivered", replied: "delivered", failed: "failed" };

export async function backfillInbox(opts: { batchSize?: number; db?: PrismaClient } = {}): Promise<BackfillResult> {
  const db = opts.db ?? prisma;
  const batch = opts.batchSize ?? 200;
  const out: BackfillResult = { scanned: 0, messagesCreated: 0, conversationsTouched: 0, skipped: 0 };
  const touched = new Set<string>();
  const createdNow = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const touches = await db.touch.findMany({
      where: { channel: "whatsapp", externalId: { not: null }, whatsappInstanceId: { not: null } },
      orderBy: { id: "asc" }, take: batch, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: {
        id: true, direction: true, status: true, content: true, externalId: true, sentAt: true, createdAt: true,
        whatsappInstance: { select: { id: true, orgId: true } },
        lead: { select: { id: true, phone: true, campaign: { select: { orgId: true } } } },
      },
    });
    if (touches.length === 0) break;
    cursor = touches[touches.length - 1].id;
    for (const t of touches) {
      out.scanned++;
      const phone = t.lead.phone ? normalizeBrPhone(t.lead.phone) : null;
      const status = STATUS[t.status];
      // Instância e lead precisam ser da MESMA org (nunca cruza org); telefone inválido ou status sem equivalente = pula.
      if (!t.whatsappInstance || !phone || !phone.ok || !status || t.whatsappInstance.orgId !== t.lead.campaign.orgId) { out.skipped++; continue; }
      const inst = t.whatsappInstance;
      const at = t.sentAt ?? t.createdAt;
      const key = { whatsappInstanceId_contactPhone: { whatsappInstanceId: inst.id, contactPhone: phone.e164 } };
      let conv = await db.waConversation.findUnique({ where: key, select: { id: true } });
      if (!conv) {
        conv = await db.waConversation.upsert({ where: key, create: { orgId: inst.orgId, whatsappInstanceId: inst.id, leadId: t.lead.id, contactPhone: phone.e164, lastMessageAt: at }, update: {}, select: { id: true } });
        createdNow.add(conv.id);
      }
      const r = await db.waMessage.createMany({
        data: [{
          orgId: inst.orgId, conversationId: conv.id, whatsappInstanceId: inst.id, direction: t.direction, origin: t.direction === "inbound" ? "lead" : "automation",
          kind: "text", body: (t.content ?? "").slice(0, MESSAGE_MAX_CHARS), externalId: t.externalId, status, touchId: t.direction === "outbound" ? t.id : null, messageAt: at,
        }],
        skipDuplicates: true,
      });
      out.messagesCreated += r.count;
      touched.add(conv.id);
    }
  }
  // Recalcula o resumo das conversas tocadas a partir das mensagens (idempotente).
  for (const id of touched) {
    const [last, lastIn] = await Promise.all([
      db.waMessage.findFirst({ where: { conversationId: id }, orderBy: [{ messageAt: "desc" }, { id: "desc" }], select: { messageAt: true, body: true, direction: true } }),
      db.waMessage.findFirst({ where: { conversationId: id, direction: "inbound" }, orderBy: { messageAt: "desc" }, select: { messageAt: true } }),
    ]);
    if (!last) continue;
    await db.waConversation.update({
      where: { id },
      data: {
        lastMessageAt: last.messageAt, lastMessagePreview: buildPreview(last.body), lastMessageDirection: last.direction, lastInboundAt: lastIn?.messageAt ?? null,
        // Só conversa recém-criada decide o estado: respondeu depois do lead = atendendo; senão aguardando.
        ...(createdNow.has(id) && lastIn && last.direction === "outbound" ? { status: "attending" as const } : {}),
      },
    });
  }
  out.conversationsTouched = touched.size;
  return out;
}
