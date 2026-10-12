"use client";
import * as React from "react";
import { ArrowDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { MessageView } from "@/lib/inbox/client-types";
import { dayKey, dayLabel } from "./inbox-format";
import { MessageBubble } from "./MessageBubble";

const BOTTOM_PX = 80;

export function MessageListSkeleton() {
  return (
    <div role="status" aria-label="Carregando mensagens" className="flex flex-1 flex-col gap-4 p-4">
      <Skeleton className="h-10 w-2/3 self-start rounded-2xl" />
      <Skeleton className="h-10 w-1/2 self-end rounded-2xl" />
      <Skeleton className="h-16 w-3/5 self-start rounded-2xl" />
      <Skeleton className="h-10 w-2/5 self-end rounded-2xl" />
    </div>
  );
}

/**
 * Lista de bolhas por dia. Rolagem: abre no fim; mensagem nova SO puxa para o fim se o usuario ja estava no fim (senao mostra
 * "N novas mensagens"); historico por `before` ao chegar no topo (posicao preservada). O anuncio para leitor de tela e separado (`aria-live` no chat).
 */
export function MessageList({
  items, now, hasMore, loadingOlder, onLoadOlder, forceBottom, newBelow, onClearNewBelow, onResend, resendingId,
}: {
  items: readonly MessageView[];
  now: Date;
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => Promise<boolean>;
  /** Muda quando o usuario envia: forca rolar ate o fim mesmo que estivesse lendo o historico. */
  forceBottom: number;
  /** Contador de novas mensagens recebidas enquanto o usuario estava rolado para cima (controlado pelo pai). */
  newBelow: number;
  onClearNewBelow: () => void;
  onResend: (m: MessageView) => void;
  resendingId: string | null;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const stick = React.useRef(true);
  const lastId = React.useRef<string | null>(null);
  const prevHeight = React.useRef<number | null>(null);
  const lastForce = React.useRef(forceBottom);

  const scrollToEnd = React.useCallback((smooth: boolean) => {
    const el = ref.current;
    if (!el) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth && !reduce ? "smooth" : "auto" });
  }, []);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prevHeight.current !== null) {
      // Historico carregado no topo: mantem a mensagem que o usuario via.
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
      return;
    }
    if (forceBottom !== lastForce.current) { lastForce.current = forceBottom; stick.current = true; }
    const newest = items[items.length - 1]?.id ?? null;
    if (newest !== lastId.current) {
      const first = lastId.current === null;
      lastId.current = newest;
      if (first || stick.current) { scrollToEnd(!first); onClearNewBelow(); }
    }
  }, [items, forceBottom, scrollToEnd, onClearNewBelow]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_PX;
    if (stick.current && newBelow > 0) onClearNewBelow();
    if (el.scrollTop < 40 && hasMore && !loadingOlder) loadOlder();
  };

  const loadOlder = () => {
    prevHeight.current = ref.current?.scrollHeight ?? null;
    void onLoadOlder().then((okLoaded) => { if (!okLoaded) prevHeight.current = null; });
  };

  const rows: React.ReactNode[] = [];
  let prevDay = "";
  for (const m of items) {
    const k = dayKey(m.messageAt);
    if (k !== prevDay) {
      prevDay = k;
      rows.push(
        <li key={`d-${k}`} className="flex justify-center py-2">
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">{dayLabel(m.messageAt, now)}</span>
        </li>,
      );
    }
    rows.push(
      <li key={m.id}>
        <MessageBubble m={m} onResend={onResend} resending={resendingId === m.id} />
      </li>,
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={ref} onScroll={onScroll} tabIndex={0} aria-label="Histórico de mensagens" className="h-full overflow-y-auto overscroll-contain px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 sm:px-4">
        {hasMore ? (
          <div className="flex justify-center pb-3">
            <Button variant="outline" size="sm" className="h-11" onClick={loadOlder} disabled={loadingOlder} aria-busy={loadingOlder}>
              {loadingOlder ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : null}
              {loadingOlder ? "Carregando…" : "Carregar mensagens anteriores"}
            </Button>
          </div>
        ) : null}
        {items.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma mensagem nesta conversa ainda.</p> : null}
        <ol className="flex flex-col gap-3">{rows}</ol>
      </div>
      {newBelow > 0 ? (
        <Button
          className="absolute bottom-3 left-1/2 h-11 -translate-x-1/2 rounded-full shadow-lg"
          onClick={() => { stick.current = true; scrollToEnd(true); onClearNewBelow(); }}
        >
          <ArrowDown aria-hidden="true" /> {newBelow === 1 ? "1 nova mensagem" : `${newBelow} novas mensagens`}
        </Button>
      ) : null}
    </div>
  );
}
