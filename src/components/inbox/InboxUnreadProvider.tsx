"use client";
import * as React from "react";
import { fetchUnread, toOutcome } from "@/lib/inbox/client-api";
import { UNREAD_POLL_MS, stripUnreadPrefix, withUnreadPrefix } from "@/lib/inbox/client-types";
import { usePolling } from "./use-polling";

/**
 * SPEC-068b: UM polling leve (20 s) do total de nao lidas da caixa. Alimenta o badge do item "Atendimento" no sidebar e o contador no
 * titulo da aba (`(3) Titulo`). Sem polling para quem nao tem caixa (`enabled=false`: platform_admin, trial expirado).
 */
interface InboxUnreadValue { unreadMessages: number; unreadConversations: number; refresh: () => void }
const Ctx = React.createContext<InboxUnreadValue>({ unreadMessages: 0, unreadConversations: 0, refresh: () => {} });
export const useInboxUnread = (): InboxUnreadValue => React.useContext(Ctx);

export function InboxUnreadProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const [counts, setCounts] = React.useState({ unreadMessages: 0, unreadConversations: 0 });
  const trigger = usePolling(
    async () => {
      const r = await fetchUnread();
      if (r.ok) setCounts((c) => (c.unreadMessages === r.unreadMessages && c.unreadConversations === r.unreadConversations ? c : { unreadMessages: r.unreadMessages, unreadConversations: r.unreadConversations }));
      return toOutcome(r);
    },
    UNREAD_POLL_MS,
    enabled,
    "unread",
  );

  const n = enabled ? counts.unreadMessages : 0;
  React.useEffect(() => {
    // O Next reescreve o <title> a cada navegacao: observa o <head> e reaplica o prefixo quando ele some.
    const apply = () => {
      const next = withUnreadPrefix(document.title, n);
      if (document.title !== next) document.title = next;
    };
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      obs.disconnect();
      document.title = stripUnreadPrefix(document.title);
    };
  }, [n]);

  const value = React.useMemo(() => ({ ...counts, refresh: trigger }), [counts, trigger]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
