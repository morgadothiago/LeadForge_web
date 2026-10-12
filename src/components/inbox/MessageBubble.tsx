import * as React from "react";
import { AlertCircle, Check, CheckCheck, Clock } from "lucide-react";
import { DELIVERY_LABEL, ORIGIN_LABEL, bodyOrKindLabel, type DeliveryStatus, type MessageView } from "@/lib/inbox/client-types";
import { cn } from "@/lib/utils";
import { formatHour, linkify } from "./inbox-format";

export function DeliveryIcon({ status }: { status: DeliveryStatus }) {
  const label = DELIVERY_LABEL[status];
  const common = { "aria-hidden": true, className: "size-3.5" } as const;
  return (
    <span className="inline-flex items-center" title={label}>
      {status === "sending" ? <Clock {...common} /> : null}
      {status === "sent" ? <Check {...common} /> : null}
      {status === "delivered" ? <CheckCheck {...common} /> : null}
      {status === "read" ? <CheckCheck {...common} className="size-3.5 text-sky-300 dark:text-sky-300" /> : null}
      {status === "failed" ? <AlertCircle {...common} /> : null}
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Texto como TEXTO (React escapa); so http/https viram link, com rel seguro e sem preview. Nunca HTML bruto. */
export function MessageText({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((s, i) =>
        s.type === "link" ? (
          <a key={i} href={s.href} target="_blank" rel="noopener noreferrer nofollow" className="break-all underline underline-offset-2">
            {s.value}
          </a>
        ) : (
          <React.Fragment key={i}>{s.value}</React.Fragment>
        ),
      )}
    </>
  );
}

export function senderLabel(m: Pick<MessageView, "origin" | "direction" | "sentByName">): string {
  if (m.origin === "manual") return m.sentByName ?? "Você";
  return ORIGIN_LABEL[m.origin];
}

export function MessageBubble({ m, onResend, resending }: { m: MessageView; onResend?: (m: MessageView) => void; resending?: boolean }) {
  const out = m.direction === "outbound";
  const sender = senderLabel(m);
  return (
    <div className={cn("flex flex-col gap-1", out ? "items-end" : "items-start")} data-direction={m.direction} data-origin={m.origin}>
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm sm:max-w-[75%]",
          out ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted text-foreground",
          m.status === "failed" && "opacity-80",
          m.kind !== "text" && !m.body && "italic",
        )}
      >
        <MessageText text={bodyOrKindLabel(m)} />
      </div>
      <div className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        {sender ? <span>{sender}</span> : null}
        {sender ? <span aria-hidden="true">·</span> : null}
        <time dateTime={m.messageAt}>{formatHour(m.messageAt)}</time>
        {out ? <DeliveryIcon status={m.status} /> : null}
      </div>
      {m.status === "failed" ? (
        <div role="alert" className="flex max-w-[85%] flex-wrap items-center justify-end gap-2 px-1 text-xs text-destructive sm:max-w-[75%]">
          <span>{m.error ?? DELIVERY_LABEL.failed}</span>
          {onResend ? (
            <button
              type="button"
              onClick={() => onResend(m)}
              disabled={resending}
              className="min-h-11 rounded-md px-3 font-medium underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
            >
              {resending ? "Reenviando…" : "Reenviar"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
