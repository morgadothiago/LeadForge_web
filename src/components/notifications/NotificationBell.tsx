"use client";
import * as React from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { fetchNotifications } from "@/lib/notifications/client";
import { bellCountText, bellLabel, type NotificationItem } from "@/lib/notifications/client-types";
import { NotificationRow } from "./NotificationRow";
import { useNotifications } from "./NotificationsProvider";

/** Botao (com ponto/contador) + Sheet com as 20 ultimas. O botao e o gatilho: ao fechar o foco volta a ele (base-ui). */
export function NotificationBell() {
  const { summary, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<NotificationItem[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const count = summary.unreadTotal;

  React.useEffect(() => {
    if (!open) return;
    const ctl = new AbortController();
    void fetchNotifications({ limit: 20 }, ctl.signal).then((r) => {
      if (ctl.signal.aborted) return;
      if (r.ok) {
        setItems(r.items);
        setFailed(false);
      } else setFailed(true);
    });
    return () => ctl.abort();
  }, [open]);

  const onRead = async (n: NotificationItem) => {
    setItems((cur) => cur?.map((x) => (x.id === n.id ? { ...x, readAt: x.readAt ?? new Date().toISOString() } : x)) ?? cur);
    if (!(await markRead(n))) toast.error("Não foi possível marcar como lida.");
  };
  const onReadAll = async () => {
    setItems((cur) => cur?.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })) ?? cur);
    if (!(await markAllRead())) toast.error("Não foi possível marcar todas como lidas.");
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="ghost" size="icon" aria-label={bellLabel(count)} data-has-unread={count > 0 ? "true" : "false"} className="relative" />}
      >
        <Bell aria-hidden="true" className="size-5" />
        {count > 0 ? (
          <span
            aria-hidden="true"
            data-slot="bell-count"
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground tabular-nums"
          >
            {bellCountText(count)}
          </span>
        ) : null}
      </SheetTrigger>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md" showCloseButton>
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle>Notificações</SheetTitle>
          <SheetDescription>{count > 0 ? `${count} ${count === 1 ? "não lida" : "não lidas"}` : "Tudo em dia."}</SheetDescription>
        </SheetHeader>
        <div className="flex items-center justify-end border-b border-border px-4 py-2">
          <Button size="sm" variant="ghost" onClick={onReadAll} disabled={count === 0}>
            <CheckCheck aria-hidden="true" />
            Marcar todas como lidas
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4" aria-live="polite">
          {failed ? (
            <p role="alert" className="text-sm text-muted-foreground">Não foi possível carregar as notificações. Tente novamente.</p>
          ) : items === null ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma notificação por enquanto.</p>
          ) : (
            <ul className="space-y-2" aria-label="Últimas notificações">
              {items.map((n) => (
                <NotificationRow key={n.id} item={n} onRead={onRead} onOpen={() => setOpen(false)} />
              ))}
            </ul>
          )}
        </div>
        <SheetFooter className="border-t border-border">
          <Link
            href="/notificacoes"
            onClick={() => setOpen(false)}
            className="inline-flex h-9 items-center justify-center rounded-md border border-border text-sm font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/40 outline-none"
          >
            Ver todas
          </Link>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
