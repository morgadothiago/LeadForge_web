import type { NotificationSummaryState } from "./client-types";

export type SummaryFetch = { status: "ok"; summary: NotificationSummaryState; etag: string | null } | { status: "not-modified" } | { status: "error" };

export interface PollerDeps {
  fetchSummary: (etag: string | null) => Promise<SummaryFetch>;
  onSummary: (s: NotificationSummaryState) => void;
  intervalMs?: number;
  isVisible?: () => boolean;
}

/**
 * SPEC-029: UM polling de summary. Pausa com aba oculta, `refresh()` (volta de foco / apos marcar lida), 304 mantem o estado,
 * erro de rede nao chama onSummary (nunca zera contadores). Sem sobreposicao de requisicoes.
 */
export function createSummaryPoller(deps: PollerDeps) {
  const interval = deps.intervalMs ?? 30_000;
  const visible = deps.isVisible ?? (() => true);
  let timer: ReturnType<typeof setInterval> | null = null;
  let etag: string | null = null;
  let inflight: Promise<void> | null = null;

  async function tick(): Promise<void> {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const r = await deps.fetchSummary(etag);
        if (r.status === "ok") {
          etag = r.etag;
          deps.onSummary(r.summary);
        }
      } catch {
        /* rede fora: mantem o ultimo estado */
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => {
        if (visible()) void tick();
      }, interval);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    /** Forca busca imediata (ignora If-None-Match para nao perder mudanca local otimista). */
    refresh(): Promise<void> {
      etag = null;
      return tick();
    },
    /** Volta de foco/visibilidade: so busca se visivel. */
    onVisible(): void {
      if (visible()) void tick();
    },
    get running() {
      return timer !== null;
    },
  };
}
