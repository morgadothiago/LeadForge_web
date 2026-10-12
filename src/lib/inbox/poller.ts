/**
 * SPEC-068b (D-068-6): polling com backoff, sem sobreposicao e com pausa quando a aba esta oculta. Puro (timers injetaveis).
 * `task` devolve `{ ok: true }` ou `{ ok: false, retryAfterMs? }` (erro/429): o proximo ciclo espera `retryAfterMs` ou dobra o intervalo (teto 60 s).
 */
export type PollOutcome = { ok: true } | { ok: false; retryAfterMs?: number };

export interface PollerOptions {
  task: () => Promise<PollOutcome>;
  intervalMs: number;
  maxBackoffMs?: number;
  isVisible?: () => boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export function computeDelay(intervalMs: number, failures: number, maxMs: number, retryAfterMs?: number): number {
  if (failures <= 0) return intervalMs;
  const exp = Math.min(maxMs, intervalMs * 2 ** failures);
  return Math.min(maxMs, Math.max(exp, retryAfterMs ?? 0));
}

export function createPoller(o: PollerOptions) {
  const maxMs = o.maxBackoffMs ?? 60_000;
  const visible = o.isVisible ?? (() => true);
  const setT = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let handle: unknown = null;
  let running = false;
  let stopped = true;
  let failures = 0;
  let again = false;

  function schedule(ms: number): void {
    if (stopped) return;
    if (handle !== null) clearT(handle);
    handle = setT(() => { handle = null; void run(); }, ms);
  }

  async function run(): Promise<void> {
    if (stopped) return;
    if (running) { again = true; return; } // nunca duas requisicoes do mesmo tipo ao mesmo tempo
    if (!visible()) return; // aba oculta: pausa; `onVisible` retoma
    running = true;
    let retryAfter: number | undefined;
    try {
      const r = await o.task();
      if (r.ok) failures = 0;
      else { failures++; retryAfter = r.retryAfterMs; }
    } catch {
      failures++;
    } finally {
      running = false;
    }
    if (stopped) return;
    if (again) { again = false; failures = 0; void run(); return; }
    schedule(computeDelay(o.intervalMs, failures, maxMs, retryAfter));
  }

  return {
    /** Busca ja e segue o ciclo. */
    start(): void { stopped = false; void run(); },
    stop(): void { stopped = true; if (handle !== null) clearT(handle); handle = null; },
    /** Busca imediata (apos enviar, trocar de conversa...). */
    trigger(): void { if (stopped) return; if (handle !== null) { clearT(handle); handle = null; } void run(); },
    /** Volta de foco/visibilidade: retoma na hora (zera o backoff). */
    onVisible(): void { if (stopped || !visible() || running) return; failures = 0; this.trigger(); },
    get failures(): number { return failures; },
  };
}
