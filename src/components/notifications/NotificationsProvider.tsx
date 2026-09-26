"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Area } from "@/lib/notifications/areas";
import { fetchNotifications, fetchSummary, postMarkAllRead, postMarkRead } from "@/lib/notifications/client";
import {
  EMPTY_SUMMARY, applyMarkAllRead, applyMarkRead, notificationHref, shouldToastReminder, type NotificationItem, type NotificationSummaryState,
} from "@/lib/notifications/client-types";
import { createSummaryPoller } from "@/lib/notifications/poller";
import { claimToastIds } from "@/lib/notifications/toast-dedupe";

export interface NotificationsContextValue {
  summary: NotificationSummaryState;
  refresh: () => Promise<void>;
  markRead: (item: Pick<NotificationItem, "id" | "kind">) => Promise<boolean>;
  markAllRead: (area?: Area) => Promise<boolean>;
}

const noop = async () => {};
const DEFAULT: NotificationsContextValue = { summary: EMPTY_SUMMARY, refresh: noop, markRead: async () => false, markAllRead: async () => false };
const Ctx = React.createContext<NotificationsContextValue>(DEFAULT);

/** Sino, sidebar e toasts leem o MESMO estado; existe UM polling (30 s) por aplicacao. */
export const useNotifications = () => React.useContext(Ctx);

export function NotificationsProvider({ initial, children }: { initial: NotificationSummaryState; children: React.ReactNode }) {
  const router = useRouter();
  const [summary, setSummary] = React.useState<NotificationSummaryState>(initial);
  const pollerRef = React.useRef<ReturnType<typeof createSummaryPoller> | null>(null);

  React.useEffect(() => {
    const poller = createSummaryPoller({
      fetchSummary: (etag) => fetchSummary(etag),
      onSummary: setSummary,
      isVisible: () => document.visibilityState === "visible",
    });
    pollerRef.current = poller;
    poller.start();
    const onVisible = () => poller.onVisible();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      poller.stop();
      pollerRef.current = null;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  const refresh = React.useCallback(async () => {
    await pollerRef.current?.refresh();
  }, []);

  const markRead = React.useCallback(async (item: Pick<NotificationItem, "id" | "kind">) => {
    setSummary((s) => applyMarkRead(s, item.kind));
    const ok = await postMarkRead(item.id);
    await refresh(); // confirma (ou desfaz a atualizacao otimista se falhou)
    return ok;
  }, [refresh]);

  const markAllRead = React.useCallback(async (area?: Area) => {
    setSummary((s) => applyMarkAllRead(s, area));
    const ok = await postMarkAllRead(area);
    await refresh();
    return ok;
  }, [refresh]);

  // Toast de lembrete: dispara so quando a contagem de Calendario muda (sem segundo polling); dedupe por id em sessionStorage.
  const calendario = summary.byArea.calendario;
  React.useEffect(() => {
    if (calendario <= 0) return;
    const ctl = new AbortController();
    void (async () => {
      const r = await fetchNotifications({ area: "calendario", unread: "true", limit: 10 }, ctl.signal);
      if (!r.ok || ctl.signal.aborted) return;
      const due = r.items.filter(shouldToastReminder);
      const fresh = new Set(claimToastIds(due.map((n) => n.id), typeof window === "undefined" ? null : window.sessionStorage));
      for (const n of due.filter((x) => fresh.has(x.id))) {
        toast(n.title, {
          id: `notification-${n.id}`,
          description: "Você tem uma reunião agendada.",
          action: { label: "Abrir", onClick: () => router.push(notificationHref(n)) },
        });
      }
    })();
    return () => ctl.abort();
  }, [calendario, router]);

  const value = React.useMemo(() => ({ summary, refresh, markRead, markAllRead }), [summary, refresh, markRead, markAllRead]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
