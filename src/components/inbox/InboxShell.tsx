"use client";
import * as React from "react";
import { MessageSquareText } from "lucide-react";
import type { StatusTab } from "@/lib/inbox/client-types";
import { cn } from "@/lib/utils";
import type { LockReason } from "@/components/billing/FeatureLockNotice";
import { ChatPanel } from "./ChatPanel";
import { ConversationList } from "./ConversationList";
import { useInboxUnread } from "./InboxUnreadProvider";
import { loadErrorText, useConversationList } from "./use-inbox-data";

/**
 * SPEC-068b: caixa de atendimento. >= 1024 px: 2 colunas (lista ~360 px + chat). Abaixo: pilha (lista OU chat, com botao Voltar).
 * Estado da conversa aberta so em memoria + `?c=` inicial (link direto); nada sensivel na URL alem do uuid.
 */
export function InboxShell({ initialConversationId, replyLock = null }: { initialConversationId: string | null; /** SPEC-069d: o plano nao libera responder (so ler) ou a assinatura esta pausada. */ replyLock?: LockReason | null }) {
  const [tab, setTab] = React.useState<StatusTab>("all");
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(initialConversationId);
  const unread = useInboxUnread();
  // Foco (mobile, pilha lista/chat): ao escolher uma conversa o foco vai ao titulo do chat; ao voltar, ao item da lista.
  const [focusChat, setFocusChat] = React.useState(false);
  const restoreFocusId = React.useRef<string | null>(null);
  const [now, setNow] = React.useState(() => new Date());

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const isStacked = () => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;
  const select = (id: string) => { setSelectedId(id); setFocusChat(isStacked()); };
  const back = () => { restoreFocusId.current = selectedId; setFocusChat(false); setSelectedId(null); };
  React.useEffect(() => {
    if (selectedId !== null || !restoreFocusId.current) return;
    const id = restoreFocusId.current;
    restoreFocusId.current = null;
    document.querySelector<HTMLElement>(`[data-conv-id="${id}"]`)?.focus();
  }, [selectedId]);

  const list = useConversationList(tab === "all" ? undefined : tab, debounced);
  const { patch, refresh } = list;
  const { refresh: refreshUnread } = unread;

  return (
    <div className="grid h-full min-h-[480px] grid-cols-1 gap-3 lg:grid-cols-[360px_minmax(0,1fr)]">
      <ConversationList
        className={cn(selectedId ? "hidden lg:flex" : "flex")}
        items={list.items}
        state={list.state}
        errorText={loadErrorText(list.errorStatus)}
        offline={list.offline}
        tab={tab}
        onTab={setTab}
        query={query}
        onQuery={setQuery}
        selectedId={selectedId}
        onSelect={select}
        hasMore={list.nextCursor !== null}
        loadingMore={list.loadingMore}
        onLoadMore={() => void list.loadMore()}
        onRetry={list.retry}
        now={now}
      />
      <div className={cn("min-h-0 min-w-0 flex-col", selectedId ? "flex" : "hidden lg:flex")}>
        {selectedId ? (
          <ChatPanel
            key={selectedId}
            conversationId={selectedId}
            onBack={back}
            focusTitleOnMount={focusChat}
            onListPatch={patch}
            onUnreadChanged={refreshUnread}
            onListRefresh={refresh}
            replyLock={replyLock}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-8 text-center">
            <MessageSquareText aria-hidden="true" className="size-10 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Selecione uma conversa</p>
            <p className="max-w-xs text-sm text-muted-foreground">Escolha uma conversa na lista para ler o histórico e responder pelo WhatsApp.</p>
          </div>
        )}
      </div>
    </div>
  );
}
