"use client";
import * as React from "react";
import {
  fetchConversation, fetchConversations, fetchMessages, toOutcome,
} from "@/lib/inbox/client-api";
import {
  CHAT_POLL_MS, LIST_POLL_MS, appendConversations, applyStatuses, hasInbound, mergeConversationHead, mergeMessages,
  type ConversationStatus, type ConversationView, type MessageView,
} from "@/lib/inbox/client-types";
import { usePolling } from "./use-polling";

export type LoadState = "loading" | "ready" | "error";

/** Texto do erro de carga a partir do status HTTP (0 = rede). */
export function loadErrorText(status: number): string {
  if (status === 401) return "Sua sessão expirou. Entre novamente para ver as conversas.";
  if (status === 403) return "Você não tem acesso à caixa de atendimento desta organização.";
  if (status === 429) return "Muitas atualizações seguidas. Vamos tentar de novo em instantes.";
  return "Não foi possível carregar. Verifique sua conexão e tente de novo.";
}

/** Lista de conversas: 1a pagina a cada 10 s (pausa com aba oculta), "carregar mais" por cursor e atualizacao otimista local. */
export function useConversationList(status: ConversationStatus | undefined, q: string) {
  const key = `${status ?? "all"}|${q}`;
  // Dados amarrados a chave (aba+busca): ao trocar a chave a lista volta ao esqueleto sem efeito de reset.
  const [data, setData] = React.useState<{ key: string; items: ConversationView[]; nextCursor: string | null; extended: boolean } | null>(null);
  const [errorStatus, setErrorStatus] = React.useState<{ key: string; status: number } | null>(null);
  const [offline, setOffline] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const keyRef = React.useRef(key);
  React.useEffect(() => { keyRef.current = key; });
  const mine = data && data.key === key ? data : null;
  const items = mine?.items ?? [];
  const nextCursor = mine?.nextCursor ?? null;
  const state: LoadState = mine ? "ready" : errorStatus?.key === key ? "error" : "loading";

  const trigger = usePolling(
    async () => {
      const r = await fetchConversations({ status, q });
      if (keyRef.current !== key) return { ok: true }; // aba/busca mudou durante a requisicao: descarta
      if (r.ok) {
        setData((d) => {
          const same = d && d.key === key ? d : null;
          return {
            key,
            items: mergeConversationHead(same?.items ?? [], r.items, r.nextCursor !== null),
            nextCursor: same?.extended ? same.nextCursor : r.nextCursor,
            extended: same?.extended ?? false,
          };
        });
        setErrorStatus(null); setOffline(false);
      } else {
        setOffline(true); setErrorStatus({ key, status: r.status });
      }
      return toOutcome(r);
    },
    LIST_POLL_MS,
    true,
    key,
  );

  const loadMore = React.useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const r = await fetchConversations({ status, q, cursor: nextCursor });
    setLoadingMore(false);
    if (!r.ok) { setOffline(true); return; }
    setData((d) => (d && d.key === key ? { ...d, items: appendConversations(d.items, r.items), nextCursor: r.nextCursor, extended: true } : d));
  }, [nextCursor, loadingMore, status, q, key]);

  const patch = React.useCallback((id: string, fn: (c: ConversationView) => ConversationView) => {
    setData((d) => (d ? { ...d, items: d.items.map((c) => (c.id === id ? fn(c) : c)) } : d));
  }, []);

  const retry = React.useCallback(() => { setErrorStatus(null); trigger(); }, [trigger]);
  return { items, state, errorStatus: errorStatus?.status ?? 0, offline: offline && state !== "error", nextCursor, loadingMore, loadMore, patch, retry, refresh: trigger };
}

/** Detalhe da conversa aberta (a lista nao confere supressao global): 1 vez ao abrir e a cada 10 s. Use com `key={id}` no componente (remonta ao trocar). */
export function useConversationDetail(id: string | null) {
  const [detail, setDetail] = React.useState<ConversationView | null>(null);
  const [state, setState] = React.useState<LoadState>("loading");
  const [errorStatus, setErrorStatus] = React.useState(0);
  // Status otimista em andamento: um poll que saiu ANTES da mudanca nao pode desfaze-la na tela.
  const holdStatus = React.useRef<ConversationStatus | null>(null);

  const trigger = usePolling(
    async () => {
      if (!id) return { ok: true };
      const r = await fetchConversation(id);
      if (r.ok) { setDetail(holdStatus.current ? { ...r.conversation, status: holdStatus.current } : r.conversation); setState("ready"); }
      else { setErrorStatus(r.status); setState((s) => (s === "ready" ? s : "error")); }
      return toOutcome(r);
    },
    LIST_POLL_MS,
    id !== null,
    id ?? "none",
  );

  const patch = React.useCallback((fn: (c: ConversationView) => ConversationView) => setDetail((d) => (d ? fn(d) : d)), []);
  const hold = React.useCallback((st: ConversationStatus | null) => { holdStatus.current = st; }, []);
  return { detail, state, errorStatus, patch, hold, refresh: trigger, notFound: state === "error" && errorStatus === 404 };
}

export interface NewMessagesInfo { count: number; inbound: boolean }

/**
 * Mensagens da conversa aberta: ultimas 30 ao abrir, poll `since` a cada 4 s (pausa com aba oculta), historico por `before`,
 * `statuses` aplicados sem regredir. Use com `key={id}` (remonta ao trocar de conversa). `onNew` avisa quando chegam mensagens novas (anuncio/rolagem/marcar como lida).
 */
export function useMessages(id: string | null, onNew: (info: NewMessagesInfo) => void) {
  const [items, setItems] = React.useState<MessageView[]>([]);
  const [state, setState] = React.useState<LoadState>("loading");
  const [errorStatus, setErrorStatus] = React.useState(0);
  const [hasMore, setHasMore] = React.useState(false);
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const [offline, setOffline] = React.useState(false);
  const olderInflight = React.useRef(false);
  const itemsRef = React.useRef<MessageView[]>([]);
  const since = React.useRef<string | null>(null);
  const before = React.useRef<string | null>(null);
  const loaded = React.useRef(false);
  const onNewRef = React.useRef(onNew);
  React.useEffect(() => { onNewRef.current = onNew; });

  const commit = React.useCallback((next: MessageView[]) => { itemsRef.current = next; setItems(next); }, []);

  const trigger = usePolling(
    async () => {
      if (!id) return { ok: true };
      const first = !loaded.current;
      const r = await fetchMessages(id, !first && since.current ? { since: since.current } : {});
      if (!r.ok) {
        setErrorStatus(r.status);
        setOffline(true);
        setState((s) => (s === "loading" ? "error" : s));
        return toOutcome(r);
      }
      setOffline(false);
      if (first) {
        loaded.current = true;
        before.current = r.nextBefore;
        setHasMore(r.hasMore);
        commit(r.items);
        setState("ready");
      } else {
        // "Novas" = ids que ainda nao estavam na tela (o poll tambem devolve a bolha ja adicionada localmente ao enviar).
        const known = new Set(itemsRef.current.map((m) => m.id));
        const fresh = r.items.filter((m) => !known.has(m.id));
        commit(applyStatuses(mergeMessages(itemsRef.current, r.items), r.statuses));
        if (fresh.length) onNewRef.current({ count: fresh.length, inbound: hasInbound(fresh) });
      }
      if (r.nextSince) since.current = r.nextSince;
      return { ok: true };
    },
    CHAT_POLL_MS,
    id !== null,
    id ?? "none",
  );

  const loadOlder = React.useCallback(async (): Promise<boolean> => {
    if (!id || !before.current || olderInflight.current) return false; // guard SINCRONO: dois disparos no mesmo tick nao duplicam
    olderInflight.current = true;
    setLoadingOlder(true);
    const r = await fetchMessages(id, { before: before.current });
    olderInflight.current = false;
    setLoadingOlder(false);
    if (!r.ok) return false;
    before.current = r.nextBefore;
    setHasMore(r.hasMore);
    commit(mergeMessages(itemsRef.current, r.items));
    return true;
  }, [id, commit]);

  const addLocal = React.useCallback((m: MessageView) => commit(mergeMessages(itemsRef.current, [m])), [commit]);
  const retry = React.useCallback(() => { setState("loading"); trigger(); }, [trigger]);
  return { items, state, errorStatus, offline, hasMore, loadingOlder, loadOlder, addLocal, refresh: trigger, retry };
}
