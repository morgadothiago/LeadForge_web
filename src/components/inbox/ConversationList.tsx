"use client";
import * as React from "react";
import { MessageSquareText, Search, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TABS, badgeText, type ConversationView, type StatusTab } from "@/lib/inbox/client-types";
import { cn } from "@/lib/utils";
import { formatListTime, initials } from "./inbox-format";

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary", className)}>
      {initials(name)}
    </span>
  );
}

export function ConversationItem({ c, selected, now, onSelect }: { c: ConversationView; selected: boolean; now: Date; onSelect: (id: string) => void }) {
  const unread = c.unreadCount > 0;
  const preview = c.lastMessagePreview ?? "Sem mensagens";
  const who = c.lastMessageDirection === "outbound" ? "Você: " : "";
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(c.id)}
        aria-current={selected ? "true" : undefined}
        data-conv-id={c.id}
        className={cn(
          "flex min-h-[68px] w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
          selected && "bg-accent",
        )}
      >
        <Avatar name={c.lead.name} />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cn("truncate text-sm", unread ? "font-semibold text-foreground" : "font-medium text-foreground")}>{c.lead.name}</span>
            <time dateTime={c.lastMessageAt} className={cn("shrink-0 text-xs", unread ? "font-medium text-primary" : "text-muted-foreground")}>
              {formatListTime(c.lastMessageAt, now)}
            </time>
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className={cn("truncate text-sm", unread ? "text-foreground" : "text-muted-foreground")}>
              {who}{preview}
            </span>
            {unread && (
              <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
                <span aria-hidden="true">{badgeText(c.unreadCount)}</span>
                <span className="sr-only">{c.unreadCount === 1 ? "1 mensagem não lida" : `${c.unreadCount} mensagens não lidas`}</span>
              </span>
            )}
          </span>
          {c.lead.company ? <span className="truncate text-xs text-muted-foreground">{c.lead.company}</span> : null}
        </span>
      </button>
    </li>
  );
}

export function ConversationListSkeleton() {
  return (
    <div role="status" aria-label="Carregando conversas" className="divide-y divide-border">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-3">
          <Skeleton className="size-11 rounded-full" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export interface ConversationListProps {
  items: readonly ConversationView[];
  state: "loading" | "ready" | "error";
  errorText: string;
  offline: boolean;
  tab: StatusTab;
  onTab: (t: StatusTab) => void;
  query: string;
  onQuery: (q: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  now: Date;
  className?: string;
}

export function ConversationList(p: ConversationListProps) {
  const tabRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + TABS.length) % TABS.length;
    p.onTab(TABS[n].key);
    tabRefs.current[n]?.focus();
  };
  const filtered = p.tab !== "all" || p.query.trim() !== "";
  return (
    <section aria-label="Conversas" className={cn("flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card", p.className)}>
      <div className="space-y-3 border-b border-border p-3">
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={p.query}
            onChange={(e) => p.onQuery(e.target.value)}
            maxLength={100}
            placeholder="Buscar por nome, empresa ou telefone"
            aria-label="Buscar conversas por nome, empresa ou telefone"
            className="h-11 w-full rounded-md border border-input bg-transparent pl-9 pr-3 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground focus:border-primary focus:ring-[3px] focus:ring-primary/20"
          />
        </div>
        <div role="tablist" aria-label="Filtrar conversas por status" className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1">
          {TABS.map((t, i) => {
            const active = p.tab === t.key;
            return (
              <button
                key={t.key}
                ref={(el) => { tabRefs.current[i] = el; }}
                type="button"
                role="tab"
                id={`inbox-tab-${t.key}`}
                aria-selected={active}
                aria-controls="inbox-list-panel"
                tabIndex={active ? 0 : -1}
                onClick={() => p.onTab(t.key)}
                onKeyDown={(e) => onTabKey(e, i)}
                className={cn(
                  "min-h-11 rounded-md px-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 sm:text-sm",
                  active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {p.offline && p.state === "ready" ? (
        <p role="status" className="flex items-center gap-2 border-b border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          <WifiOff aria-hidden="true" className="size-3.5" /> Sem conexão. Tentando atualizar de novo…
        </p>
      ) : null}

      <div id="inbox-list-panel" role="tabpanel" aria-labelledby={`inbox-tab-${p.tab}`} className="min-h-0 flex-1 overflow-y-auto">
        {p.state === "loading" ? <ConversationListSkeleton /> : null}
        {p.state === "error" ? (
          <div role="alert" className="flex flex-col items-center gap-3 p-6 text-center">
            <p className="text-sm text-muted-foreground">{p.errorText}</p>
            <Button variant="outline" className="h-11" onClick={p.onRetry}>Tentar de novo</Button>
          </div>
        ) : null}
        {p.state === "ready" && p.items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <MessageSquareText aria-hidden="true" className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">{filtered ? "Nenhuma conversa encontrada" : "Nenhuma conversa ainda"}</p>
            <p className="text-sm text-muted-foreground">
              {filtered ? "Tente outra aba ou outro termo de busca." : "Quando um lead responder no WhatsApp, a conversa aparece aqui."}
            </p>
          </div>
        ) : null}
        {p.state === "ready" && p.items.length > 0 ? (
          <>
            <ul aria-label="Lista de conversas">
              {p.items.map((c) => <ConversationItem key={c.id} c={c} selected={c.id === p.selectedId} now={p.now} onSelect={p.onSelect} />)}
            </ul>
            {p.hasMore ? (
              <div className="p-3">
                <Button variant="outline" className="h-11 w-full" onClick={p.onLoadMore} disabled={p.loadingMore} aria-busy={p.loadingMore}>
                  {p.loadingMore ? "Carregando…" : "Carregar mais conversas"}
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

/** Pequena etiqueta de status reutilizada no cabecalho do chat. */
export function StatusBadge({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "destructive" | "default" }) {
  return <Badge variant={tone}>{children}</Badge>;
}
