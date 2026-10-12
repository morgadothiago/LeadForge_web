"use client";
import * as React from "react";
import { createPoller, type PollOutcome } from "@/lib/inbox/poller";

/**
 * SPEC-068b: liga um `createPoller` ao ciclo de vida do componente. Pausa com aba oculta (retoma ao voltar o foco/visibilidade),
 * backoff em erro/429 e sem sobreposicao. `resetKey` recria o ciclo (troca de conversa/filtro). Devolve `trigger` para busca imediata.
 */
export function usePolling(task: () => Promise<PollOutcome>, intervalMs: number, enabled: boolean, resetKey: string): () => void {
  const taskRef = React.useRef(task);
  React.useEffect(() => { taskRef.current = task; });
  const pollerRef = React.useRef<ReturnType<typeof createPoller> | null>(null);

  React.useEffect(() => {
    if (!enabled) return;
    const poller = createPoller({ task: () => taskRef.current(), intervalMs, isVisible: () => document.visibilityState === "visible" });
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
  }, [enabled, intervalMs, resetKey]);

  return React.useCallback(() => pollerRef.current?.trigger(), []);
}
