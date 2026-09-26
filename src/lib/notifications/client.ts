import { isSummary, type NotificationItem } from "./client-types";
import type { Area } from "./areas";
import type { SummaryFetch } from "./poller";

/** SPEC-029: chamadas fetch as rotas de sessao da SPEC-028. Erros de rede viram resultado (nunca lancam para a UI). */
export async function fetchSummary(etag: string | null, signal?: AbortSignal): Promise<SummaryFetch> {
  try {
    const res = await fetch("/api/notifications/summary", { cache: "no-store", signal, headers: etag ? { "If-None-Match": etag } : {} });
    if (res.status === 304) return { status: "not-modified" };
    if (!res.ok) return { status: "error" };
    const json = (await res.json()) as { data?: unknown };
    return isSummary(json.data) ? { status: "ok", summary: json.data, etag: res.headers.get("ETag") } : { status: "error" };
  } catch {
    return { status: "error" };
  }
}

export interface ListParams { area?: Area | ""; kind?: string; unread?: "true" | "false" | ""; cursor?: string | null; limit?: number }
export function buildListUrl(p: ListParams): string {
  const q = new URLSearchParams();
  if (p.area) q.set("area", p.area);
  if (p.kind) q.set("kind", p.kind);
  if (p.unread) q.set("unread", p.unread);
  if (p.cursor) q.set("cursor", p.cursor);
  q.set("limit", String(p.limit ?? 20));
  return `/api/notifications?${q.toString()}`;
}

export type ListResult = { ok: true; items: NotificationItem[]; nextCursor: string | null } | { ok: false };
export async function fetchNotifications(p: ListParams, signal?: AbortSignal): Promise<ListResult> {
  try {
    const res = await fetch(buildListUrl(p), { cache: "no-store", signal });
    if (!res.ok) return { ok: false };
    const json = (await res.json()) as { data?: NotificationItem[]; meta?: { nextCursor?: string | null } };
    return Array.isArray(json.data) ? { ok: true, items: json.data, nextCursor: json.meta?.nextCursor ?? null } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function postMarkRead(id: string): Promise<boolean> {
  try {
    return (await fetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "POST" })).ok;
  } catch {
    return false;
  }
}
export async function postMarkAllRead(area?: Area): Promise<boolean> {
  try {
    return (await fetch("/api/notifications/read-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(area ? { area } : {}) })).ok;
  } catch {
    return false;
  }
}
