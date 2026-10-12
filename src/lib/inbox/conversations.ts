import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findSuppression } from "@/lib/domain/suppression";
import { CONVERSATION_WINDOW_MS } from "./constants";
import { clampLimit } from "./messages";
import { decodeCursor, encodeCursor } from "./cursor";
import { maskPhone } from "./text";

export type ReplyBlockReason = "opted_out" | "conversation_window_closed" | "instance_unavailable";
export type ConversationStatusFilter = "waiting" | "attending" | "closed";

export interface ConversationView {
  id: string;
  status: ConversationStatusFilter;
  unreadCount: number;
  lastMessageAt: string;
  lastInboundAt: string | null;
  lastMessagePreview: string | null;
  lastMessageDirection: "inbound" | "outbound" | null;
  /** Fim da janela de 24h para responder (null = o lead nunca escreveu: sem resposta manual possível). */
  windowClosesAt: string | null;
  /** Motivo do composer bloqueado, calculado com o relógio do servidor. Supressão global só é conferida no detalhe/envio (evita N+1). */
  replyBlockedReason: ReplyBlockReason | null;
  phoneMasked: string;
  lead: { id: string; name: string; company: string | null; tags: string[]; possibleOptOut: boolean; optedOut: boolean };
  instance: { id: string; connected: boolean; paused: boolean };
}

const INCLUDE = {
  lead: { select: { id: true, name: true, company: true, tags: true, possibleOptOut: true, optedOutAt: true, sequenceStatus: true, email: true } },
  whatsappInstance: { select: { id: true, status: true, health: true, pausedUntil: true } },
} satisfies Prisma.WaConversationInclude;
type Full = Prisma.WaConversationGetPayload<{ include: typeof INCLUDE }>;

export function instancePaused(i: { health: string; pausedUntil: Date | null }, now: Date): boolean {
  return i.health === "paused" && (!i.pausedUntil || i.pausedUntil.getTime() > now.getTime());
}

export function toConversationView(c: Full, now: Date): ConversationView {
  const optedOut = !!c.lead.optedOutAt || c.lead.sequenceStatus === "opted_out";
  const windowEnd = c.lastInboundAt ? new Date(c.lastInboundAt.getTime() + CONVERSATION_WINDOW_MS) : null;
  const paused = instancePaused(c.whatsappInstance, now);
  const connected = c.whatsappInstance.status === "connected";
  let reason: ReplyBlockReason | null = null;
  if (!connected || paused) reason = "instance_unavailable";
  else if (optedOut) reason = "opted_out";
  else if (!windowEnd || windowEnd.getTime() < now.getTime()) reason = "conversation_window_closed";
  return {
    id: c.id, status: c.status, unreadCount: c.unreadCount, lastMessageAt: c.lastMessageAt.toISOString(),
    lastInboundAt: c.lastInboundAt?.toISOString() ?? null, lastMessagePreview: c.lastMessagePreview, lastMessageDirection: c.lastMessageDirection,
    windowClosesAt: windowEnd?.toISOString() ?? null, replyBlockedReason: reason, phoneMasked: maskPhone(c.contactPhone),
    lead: { id: c.lead.id, name: c.lead.name, company: c.lead.company, tags: c.lead.tags, possibleOptOut: c.lead.possibleOptOut, optedOut },
    instance: { id: c.whatsappInstance.id, connected, paused },
  };
}

export interface ListQuery { status?: ConversationStatusFilter; q?: string; cursor?: string; limit?: number }
export interface ConversationsPage { items: ConversationView[]; nextCursor: string | null }

/**
 * Lista por `lastMessageAt DESC, id DESC` (índice `orgId,status,lastMessageAt`), 1 query com `include` (sem N+1). Sem `status` = todas.
 * `waiting` só traz conversas em que o lead já escreveu (Q-068-6: só mensagens automáticas ficam fora de "Aguardando", mas aparecem em "Todas").
 * Busca `q` por nome/empresa/telefone do lead, no servidor.
 */
export async function listConversations(orgId: string, now: Date, query: ListQuery = {}): Promise<ConversationsPage | "invalid_cursor"> {
  const limit = clampLimit(query.limit);
  const and: Prisma.WaConversationWhereInput[] = [{ orgId }];
  if (query.status) and.push({ status: query.status });
  if (query.status === "waiting") and.push({ lastInboundAt: { not: null } });
  const q = query.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, "");
    and.push({
      OR: [
        { lead: { name: { contains: q, mode: "insensitive" } } },
        { lead: { company: { contains: q, mode: "insensitive" } } },
        ...(digits.length >= 3 ? [{ contactPhone: { contains: digits } }] : []),
      ],
    });
  }
  if (query.cursor !== undefined) {
    const c = decodeCursor(query.cursor);
    if (!c) return "invalid_cursor";
    and.push({ OR: [{ lastMessageAt: { lt: c.at } }, { lastMessageAt: c.at, id: { lt: c.id } }] });
  }
  const rows = await prisma.waConversation.findMany({
    where: { AND: and }, orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }], take: limit + 1, include: INCLUDE,
  });
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { items: page.map((c) => toConversationView(c, now)), nextCursor: rows.length > limit && last ? encodeCursor(last.lastMessageAt, last.id) : null };
}

/** Detalhe de UMA conversa da org (null = inexistente ou de outra org -> 404 uniforme). Aqui a supressão global também é conferida. */
export async function getConversation(orgId: string, conversationId: string, now: Date): Promise<ConversationView | null> {
  const c = await prisma.waConversation.findFirst({ where: { id: conversationId, orgId }, include: INCLUDE });
  if (!c) return null;
  const view = toConversationView(c, now);
  if (view.replyBlockedReason !== "opted_out" && view.replyBlockedReason !== "instance_unavailable" && (await findSuppression({ email: c.lead.email, phone: c.contactPhone }, orgId))) {
    return { ...view, replyBlockedReason: "opted_out", lead: { ...view.lead, optedOut: true } };
  }
  return view;
}

/** Zera o não lido da conversa (nível org, compartilhado). Idempotente. `false` = não existe nesta org. */
export async function markRead(orgId: string, conversationId: string): Promise<boolean> {
  const r = await prisma.waConversation.updateMany({ where: { id: conversationId, orgId }, data: { unreadCount: 0 } });
  return r.count > 0;
}

/** Muda o estado manualmente (encerrar / reabrir). `false` = não existe nesta org. */
export async function setStatus(orgId: string, conversationId: string, status: ConversationStatusFilter): Promise<boolean> {
  const r = await prisma.waConversation.updateMany({ where: { id: conversationId, orgId }, data: { status } });
  return r.count > 0;
}
