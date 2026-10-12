import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX } from "./constants";
import { decodeCursor, encodeCursor } from "./cursor";

/** Visão de uma mensagem para o front. NUNCA inclui `orgId`, `externalId` nem telefone. */
export interface MessageView {
  id: string;
  direction: "inbound" | "outbound";
  origin: "lead" | "automation" | "manual" | "device";
  kind: "text" | "image" | "audio" | "document" | "video" | "other";
  body: string;
  status: "sending" | "sent" | "delivered" | "read" | "failed";
  error: string | null;
  messageAt: string;
  clientMessageId: string | null;
  sentByName: string | null;
}

interface Row {
  id: string; direction: MessageView["direction"]; origin: MessageView["origin"]; kind: MessageView["kind"]; body: string;
  status: MessageView["status"]; error: string | null; messageAt: Date; clientMessageId: string | null;
  sentBy?: { name: string } | null;
}

export function toMessageView(r: Row): MessageView {
  return {
    id: r.id, direction: r.direction, origin: r.origin, kind: r.kind, body: r.body, status: r.status, error: r.error,
    messageAt: r.messageAt.toISOString(), clientMessageId: r.clientMessageId, sentByName: r.sentBy?.name ?? null,
  };
}

const SELECT = {
  id: true, direction: true, origin: true, kind: true, body: true, status: true, error: true, messageAt: true, clientMessageId: true,
  sentBy: { select: { name: true } },
} satisfies Prisma.WaMessageSelect;

export interface MessagesPage {
  /** Ordem cronológica crescente (a mais antiga primeiro), pronta para renderizar. */
  items: MessageView[];
  /** `before`: cursor da página mais antiga seguinte (null = não há mais histórico). */
  nextBefore: string | null;
  /** Cursor para o próximo poll (`since`): o da última mensagem devolvida ou o `since` recebido. */
  nextSince: string | null;
  hasMore: boolean;
  /** Só no modo `since`: estado atual das últimas mensagens enviadas ainda não finais (entregue/lida/falha), para refletir `delivered`/`read`. */
  statuses?: { id: string; status: MessageView["status"]; error: string | null }[];
}

export interface MessagesQuery { before?: string; since?: string; limit?: number }

export const clampLimit = (n: number | undefined): number => Math.min(Math.max(Math.floor(n ?? LIST_LIMIT_DEFAULT), 1), LIST_LIMIT_MAX);

/**
 * Mensagens de UMA conversa DA ORG (`null` = conversa inexistente OU de outra org: o chamador responde 404 uniforme).
 * Sem cursor: as `limit` mais recentes. `before`: mais antigas que o cursor (histórico). `since`: só as mais novas (polling).
 * Ordenação total `(messageAt, id)`: empate de `messageAt` não perde nem repete mensagem entre páginas.
 */
export async function listMessages(orgId: string, conversationId: string, q: MessagesQuery = {}): Promise<MessagesPage | "invalid_cursor" | null> {
  const conv = await prisma.waConversation.findFirst({ where: { id: conversationId, orgId }, select: { id: true } });
  if (!conv) return null;
  const limit = clampLimit(q.limit);
  const base = { orgId, conversationId };

  if (q.since !== undefined) {
    const c = decodeCursor(q.since);
    if (!c) return "invalid_cursor";
    const rows = await prisma.waMessage.findMany({
      where: { ...base, OR: [{ messageAt: { gt: c.at } }, { messageAt: c.at, id: { gt: c.id } }] },
      orderBy: [{ messageAt: "asc" }, { id: "asc" }], take: limit + 1, select: SELECT,
    });
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    const recent = await prisma.waMessage.findMany({
      where: { ...base, direction: "outbound", status: { in: ["sending", "sent", "delivered"] } },
      orderBy: [{ messageAt: "desc" }, { id: "desc" }], take: 50, select: { id: true, status: true, error: true },
    });
    return {
      items: items.map(toMessageView), nextBefore: null, nextSince: last ? encodeCursor(last.messageAt, last.id) : q.since,
      hasMore: rows.length > limit, statuses: recent,
    };
  }

  let where: Prisma.WaMessageWhereInput = base;
  if (q.before !== undefined) {
    const c = decodeCursor(q.before);
    if (!c) return "invalid_cursor";
    where = { ...base, OR: [{ messageAt: { lt: c.at } }, { messageAt: c.at, id: { lt: c.id } }] };
  }
  const rows = await prisma.waMessage.findMany({ where, orderBy: [{ messageAt: "desc" }, { id: "desc" }], take: limit + 1, select: SELECT });
  const page = rows.slice(0, limit);
  const oldest = page[page.length - 1];
  const newest = page[0];
  return {
    items: page.reverse().map(toMessageView),
    nextBefore: rows.length > limit && oldest ? encodeCursor(oldest.messageAt, oldest.id) : null,
    nextSince: newest ? encodeCursor(newest.messageAt, newest.id) : null,
    hasMore: rows.length > limit,
  };
}
