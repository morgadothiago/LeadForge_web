"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { notificationHref, relativeTime, type NotificationItem } from "@/lib/notifications/client-types";
import { cn } from "@/lib/utils";
import { KindIcon, isUnread } from "./notification-ui";

/** Linha reutilizada pelo Sheet do sino e pela pagina /notificacoes. */
export function NotificationRow({ item, onRead, onOpen, now }: { item: NotificationItem; onRead: (n: NotificationItem) => void; onOpen?: (n: NotificationItem) => void; now?: number }) {
  const unread = isUnread(item);
  return (
    <li className={cn("flex gap-3 rounded-lg border border-border p-3", unread ? "bg-primary/5" : "opacity-75")} data-unread={unread ? "true" : "false"}>
      <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md", unread ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
        <KindIcon kind={item.kind} />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-tight">
            {item.title}
            {unread ? <span className="sr-only"> (não lida)</span> : null}
          </p>
          <time dateTime={item.createdAt} className="shrink-0 text-xs text-muted-foreground">{relativeTime(item.createdAt, now)}</time>
        </div>
        <p className="text-xs text-muted-foreground">{item.body}</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Link
            href={notificationHref(item)}
            onClick={() => onOpen?.(item)}
            className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/40 outline-none"
          >
            Abrir<span className="sr-only">: {item.title}</span>
          </Link>
          {unread ? (
            <Button size="sm" variant="ghost" onClick={() => onRead(item)}>
              Marcar como lida<span className="sr-only">: {item.title}</span>
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
