import type { ConversationView, ConversationStatus, DeliveryStatus, MessageView } from "./client-types";
import type { PollOutcome } from "./poller";

/**
 * SPEC-068b: chamadas fetch as rotas de leitura `/api/inbox/**` (068a). Erro de rede/HTTP vira resultado tipado (nunca lanca para a UI).
 * 401/403/404/429 distinguidos para a UI decidir (429 respeita `Retry-After`).
 */
export type ApiFail = { ok: false; status: number; retryAfterMs?: number };
export type ApiResult<T> = ({ ok: true } & T) | ApiFail;

async function getJson(url: string, signal?: AbortSignal): Promise<ApiResult<{ data: unknown; meta: Record<string, unknown> }> | { ok: false; status: 0 }> {
  try {
    const res = await fetch(url, { cache: "no-store", signal, headers: { Accept: "application/json" } });
    if (!res.ok) {
      const ra = Number(res.headers.get("Retry-After"));
      return { ok: false, status: res.status, retryAfterMs: res.status === 429 && ra > 0 ? ra * 1000 : undefined };
    }
    const json = (await res.json()) as { data?: unknown; meta?: Record<string, unknown> };
    return { ok: true, data: json.data, meta: json.meta ?? {} };
  } catch {
    return { ok: false, status: 0 };
  }
}

export const toOutcome = (r: { ok: boolean; retryAfterMs?: number }): PollOutcome => (r.ok ? { ok: true } : { ok: false, retryAfterMs: r.retryAfterMs });

export function conversationsUrl(p: { status?: ConversationStatus; q?: string; cursor?: string | null; limit?: number }): string {
  const q = new URLSearchParams();
  if (p.status) q.set("status", p.status);
  if (p.q?.trim()) q.set("q", p.q.trim().slice(0, 100));
  if (p.cursor) q.set("cursor", p.cursor);
  q.set("limit", String(p.limit ?? 30));
  return `/api/inbox/conversations?${q.toString()}`;
}

export async function fetchConversations(p: Parameters<typeof conversationsUrl>[0], signal?: AbortSignal): Promise<ApiResult<{ items: ConversationView[]; nextCursor: string | null }>> {
  const r = await getJson(conversationsUrl(p), signal);
  if (!r.ok) return r;
  if (!Array.isArray(r.data)) return { ok: false, status: 0 };
  return { ok: true, items: r.data as ConversationView[], nextCursor: typeof r.meta.nextCursor === "string" ? r.meta.nextCursor : null };
}

export async function fetchConversation(id: string, signal?: AbortSignal): Promise<ApiResult<{ conversation: ConversationView }>> {
  const r = await getJson(`/api/inbox/conversations/${encodeURIComponent(id)}`, signal);
  if (!r.ok) return r;
  return r.data && typeof r.data === "object" ? { ok: true, conversation: r.data as ConversationView } : { ok: false, status: 0 };
}

export interface MessagesPayload {
  items: MessageView[];
  nextBefore: string | null;
  nextSince: string | null;
  hasMore: boolean;
  statuses?: { id: string; status: DeliveryStatus; error: string | null }[];
}

export async function fetchMessages(id: string, p: { since?: string; before?: string; limit?: number }, signal?: AbortSignal): Promise<ApiResult<MessagesPayload>> {
  const q = new URLSearchParams();
  if (p.since) q.set("since", p.since);
  if (p.before) q.set("before", p.before);
  q.set("limit", String(p.limit ?? 30));
  const r = await getJson(`/api/inbox/conversations/${encodeURIComponent(id)}/messages?${q.toString()}`, signal);
  if (!r.ok) return r;
  if (!Array.isArray(r.data)) return { ok: false, status: 0 };
  const m = r.meta as Partial<MessagesPayload>;
  return {
    ok: true, items: r.data as MessageView[], nextBefore: m.nextBefore ?? null, nextSince: m.nextSince ?? null, hasMore: !!m.hasMore, statuses: m.statuses,
  };
}

export async function fetchUnread(signal?: AbortSignal): Promise<ApiResult<{ unreadMessages: number; unreadConversations: number }>> {
  const r = await getJson("/api/inbox/unread-count", signal);
  if (!r.ok) return r;
  const d = r.data as { unreadMessages?: unknown; unreadConversations?: unknown } | null;
  return d && typeof d.unreadMessages === "number" && typeof d.unreadConversations === "number"
    ? { ok: true, unreadMessages: d.unreadMessages, unreadConversations: d.unreadConversations }
    : { ok: false, status: 0 };
}
