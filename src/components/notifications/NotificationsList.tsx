"use client";
import * as React from "react";
import { CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AREAS, type Area } from "@/lib/notifications/areas";
import { fetchNotifications, type ListParams } from "@/lib/notifications/client";
import type { NotificationItem } from "@/lib/notifications/client-types";
import { KIND_LABELS } from "./notification-ui";
import { NotificationRow } from "./NotificationRow";
import { useNotifications } from "./NotificationsProvider";

export const AREA_LABELS: Record<Area, string> = { calendario: "Calendário", leads: "Leads", configuracoes: "Configurações", aprovacoes: "Aprovações" };
const selectCls = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20";

/** /notificacoes: lista completa (cursor), filtros por area/tipo e lidas/nao lidas. */
export function NotificationsList() {
  const { markRead, markAllRead, summary } = useNotifications();
  const [area, setArea] = React.useState<Area | "">("");
  const [kind, setKind] = React.useState("");
  const [unread, setUnread] = React.useState<"" | "true" | "false">("");
  const [items, setItems] = React.useState<NotificationItem[]>([]);
  const [next, setNext] = React.useState<string | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [more, setMore] = React.useState(false);

  const onFilter = <T,>(set: (v: T) => void) => (v: T) => {
    setState("loading");
    set(v);
  };
  const filters = React.useMemo<ListParams>(() => ({ area, kind, unread, limit: 20 }), [area, kind, unread]);
  React.useEffect(() => {
    const ctl = new AbortController();
    void fetchNotifications(filters, ctl.signal).then((r) => {
      if (ctl.signal.aborted) return;
      if (r.ok) {
        setItems(r.items);
        setNext(r.nextCursor);
        setState("ready");
      } else setState("error");
    });
    return () => ctl.abort();
  }, [filters]);

  const loadMore = async () => {
    if (!next) return;
    setMore(true);
    const r = await fetchNotifications({ ...filters, cursor: next });
    setMore(false);
    if (!r.ok) return void toast.error("Não foi possível carregar mais notificações.");
    setItems((cur) => [...cur, ...r.items.filter((n) => !cur.some((c) => c.id === n.id))]);
    setNext(r.nextCursor);
  };
  const onRead = async (n: NotificationItem) => {
    const stamp = new Date().toISOString();
    setItems((cur) => (unread === "true" ? cur.filter((x) => x.id !== n.id) : cur.map((x) => (x.id === n.id ? { ...x, readAt: x.readAt ?? stamp } : x))));
    if (!(await markRead(n))) toast.error("Não foi possível marcar como lida.");
  };
  const onReadAll = async () => {
    const stamp = new Date().toISOString();
    setItems((cur) => (unread === "true" ? [] : cur.map((x) => ({ ...x, readAt: x.readAt ?? stamp }))));
    if (await markAllRead(area || undefined)) toast.success("Notificações marcadas como lidas.");
    else toast.error("Não foi possível marcar todas como lidas.");
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <form role="search" aria-label="Filtrar notificações" onSubmit={(e) => e.preventDefault()} className="grid gap-3 sm:grid-cols-4 sm:items-end">
        <div className="space-y-1">
          <label htmlFor="nf-area" className="text-xs font-medium text-muted-foreground">Área</label>
          <select id="nf-area" className={selectCls} value={area} onChange={(e) => onFilter(setArea)(e.target.value as Area | "")}>
            <option value="">Todas</option>
            {AREAS.map((a) => (
              <option key={a} value={a}>{AREA_LABELS[a]}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="nf-kind" className="text-xs font-medium text-muted-foreground">Tipo</label>
          <select id="nf-kind" className={selectCls} value={kind} onChange={(e) => onFilter(setKind)(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(KIND_LABELS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="nf-unread" className="text-xs font-medium text-muted-foreground">Situação</label>
          <select id="nf-unread" className={selectCls} value={unread} onChange={(e) => onFilter(setUnread)(e.target.value as "" | "true" | "false")}>
            <option value="">Todas</option>
            <option value="true">Não lidas</option>
            <option value="false">Lidas</option>
          </select>
        </div>
        <Button variant="outline" onClick={onReadAll} disabled={summary.unreadTotal === 0}>
          <CheckCheck aria-hidden="true" />
          Marcar todas como lidas
        </Button>
      </form>

      <div aria-live="polite" aria-busy={state === "loading"}>
        {state === "loading" ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : state === "error" ? (
          <p role="alert" className="text-sm text-muted-foreground">Não foi possível carregar as notificações. Tente novamente.</p>
        ) : items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nenhuma notificação encontrada.</p>
        ) : (
          <ul className="space-y-2" aria-label="Notificações">
            {items.map((n) => (
              <NotificationRow key={n.id} item={n} onRead={onRead} />
            ))}
          </ul>
        )}
      </div>
      {next && state === "ready" ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={more} aria-busy={more}>
            {more ? "Carregando..." : "Carregar mais"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
