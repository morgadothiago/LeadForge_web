import { nextPollDelay, urlRefreshDelayMs } from "./creative-format";

/**
 * SPEC-051b — lógica de ciclo de vida (polling do detalhe, renovação da URL assinada do player e envio do wizard)
 * extraída dos componentes para TS puro: timers/visibilidade/chamadas ao servidor são injetados e testáveis sem DOM.
 */

type Failure = { ok: false; errors: Record<string, string[]> };
type Result<T> = { ok: true; data: T } | Failure;

export const MAX_POLL_ERRORS = 5;
export const MAX_NOT_FOUND = 2;
export const MAX_URL_RETRIES = 4;
export const MAX_PLAYBACK_ERRORS = 3;

export function isNotFoundFailure(errors: Record<string, string[]>): boolean {
  return Object.values(errors).flat().some((m) => /n[ãa]o encontrad/i.test(m));
}

/** Backoff exponencial limitado para retentativas (2 s, 4 s, 8 s, ... até 30 s). */
export function retryDelayMs(attempt: number): number {
  return Math.min(30_000, 2000 * 2 ** Math.max(0, attempt - 1));
}

// ---------------------------------------------------------------- polling

export type PollStatus = "ok" | "retrying" | "done" | "gone" | "gave_up";

export interface PollDeps<T> {
  fetch: () => Promise<Result<T>>;
  isDone: (data: T) => boolean;
  onData: (data: T) => void;
  onStatus?: (s: PollStatus) => void;
  isVisible: () => boolean;
  /** Assina mudanças de visibilidade; devolve o cancelamento. */
  subscribeVisibility: (cb: () => void) => () => void;
}

export interface PollController {
  start(): void;
  stop(): void;
  /** Zera contadores de erro e consulta já (botão "Atualizar agora"). */
  restart(): void;
}

export function createPollController<T>(deps: PollDeps<T>): PollController {
  let stopped = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let errors = 0;
  let notFound = 0;
  let unsub: (() => void) | undefined;

  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const halt = (s: PollStatus) => {
    stopped = true;
    clear();
    unsub?.();
    unsub = undefined;
    deps.onStatus?.(s);
  };
  const schedule = () => {
    clear();
    if (stopped || !deps.isVisible()) return; // oculta: sem timer; a volta da aba faz refresh imediato
    timer = setTimeout(() => void tick(), nextPollDelay(errors));
  };
  async function tick() {
    clear();
    if (stopped || inFlight || !deps.isVisible()) return;
    inFlight = true;
    let res: Result<T>;
    try {
      res = await deps.fetch();
    } catch {
      res = { ok: false, errors: { _form: ["network"] } };
    } finally {
      inFlight = false;
    }
    if (stopped) return;
    if (res.ok) {
      errors = 0;
      notFound = 0;
      deps.onData(res.data);
      if (stopped) return;
      if (deps.isDone(res.data)) return halt("done");
      deps.onStatus?.("ok");
      return schedule();
    }
    errors++;
    notFound = isNotFoundFailure(res.errors) ? notFound + 1 : 0;
    if (notFound >= MAX_NOT_FOUND) return halt("gone");
    if (errors >= MAX_POLL_ERRORS) return halt("gave_up");
    deps.onStatus?.("retrying");
    schedule();
  }
  const onVisibility = () => {
    if (stopped) return;
    if (deps.isVisible()) void tick();
    else clear();
  };
  return {
    start() {
      stopped = false;
      errors = 0;
      notFound = 0;
      unsub?.();
      unsub = deps.subscribeVisibility(onVisibility);
      schedule();
    },
    stop() {
      stopped = true;
      clear();
      unsub?.();
      unsub = undefined;
    },
    restart() {
      this.start();
      void tick();
    },
  };
}

// ------------------------------------------------------- URL assinada do player

export type VideoPanel = "player" | "error" | "loading";

/** Qual painel do player mostrar. Erro vence a URL: após desistir (reprodução/renovação) o <video> está quebrado. */
export function videoPanelState(s: { url?: string; error?: string; loading?: boolean }): VideoPanel {
  if (s.error) return "error";
  if (s.url) return "player";
  return "loading";
}

export interface ResumeSnapshot {
  currentTime: number;
  paused: boolean;
  ended: boolean;
}
/** Decide o que restaurar ao trocar o `src` do <video> (renovação da URL não pode reiniciar a reprodução). */
export function planResume(s: ResumeSnapshot): { time: number; play: boolean } {
  if (s.ended || !Number.isFinite(s.currentTime) || s.currentTime < 0) return { time: 0, play: false };
  return { time: s.currentTime, play: !s.paused };
}

export interface UrlRenewerDeps {
  getUrl: () => Promise<Result<{ url: string; expiresInSeconds: number }>>;
  onUrl: (url: string) => void;
  /** Esgotou as tentativas. */
  onGaveUp: (errors: Record<string, string[]> | null) => void;
  /** Mudança de "carregando a URL" (retry em andamento). */
  onRetrying?: (attempt: number) => void;
}
export interface UrlRenewer {
  start(): void;
  stop(): void;
  /** `<video>` falhou: busca nova URL com backoff e teto de tentativas. */
  reportPlaybackError(): void;
  /** `<video>` carregou/tocou: zera o contador de erros de reprodução. */
  reportPlaybackOk(): void;
  /** Reinicia tudo (botão "Tentar de novo"). */
  restart(): void;
}

export function createUrlRenewer(deps: UrlRenewerDeps): UrlRenewer {
  let stopped = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let playbackErrors = 0;
  let generation = 0;
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  async function fetchWithRetry(gen: number) {
    let last: Record<string, string[]> | null = null;
    for (let attempt = 0; attempt <= MAX_URL_RETRIES; attempt++) {
      if (attempt > 0) {
        deps.onRetrying?.(attempt);
        await new Promise<void>((resolve) => {
          timer = setTimeout(resolve, retryDelayMs(attempt));
        });
        if (stopped || gen !== generation) return;
      }
      try {
        const res = await deps.getUrl();
        if (stopped || gen !== generation) return;
        if (res.ok) {
          deps.onUrl(res.data.url);
          timer = setTimeout(() => void cycle(), urlRefreshDelayMs(res.data.expiresInSeconds));
          return;
        }
        last = res.errors;
        if (isNotFoundFailure(res.errors)) break; // não adianta insistir
      } catch {
        if (stopped || gen !== generation) return;
        last = null;
      }
    }
    deps.onGaveUp(last);
  }
  function cycle() {
    clear();
    if (stopped) return Promise.resolve();
    return fetchWithRetry(++generation);
  }
  return {
    start() {
      stopped = false;
      playbackErrors = 0;
      void cycle();
    },
    stop() {
      stopped = true;
      generation++;
      clear();
    },
    reportPlaybackError() {
      if (stopped) return;
      playbackErrors++;
      if (playbackErrors > MAX_PLAYBACK_ERRORS) {
        generation++;
        clear();
        stopped = true; // desistiu: novos erros do <video> não disparam nada até restart()
        deps.onGaveUp(null);
        return;
      }
      generation++;
      clear();
      timer = setTimeout(() => void cycle(), retryDelayMs(playbackErrors));
    },
    reportPlaybackOk() {
      playbackErrors = 0;
    },
    restart() {
      this.stop();
      this.start();
    },
  };
}

// ---------------------------------------------------------------- wizard

export type WizardSubmitOutcome<F> =
  | { kind: "busy" }
  | { kind: "draft_error"; errors: F }
  | { kind: "draft_threw" }
  | { kind: "sent"; id: string }
  | { kind: "not_sent"; id: string; errors: F }
  | { kind: "submit_threw"; id: string };

export interface WizardSubmitDeps<V, F extends Record<string, string[]>> {
  createDraft: (values: V) => Promise<{ ok: true; data: { id: string } } | { ok: false; errors: F }>;
  submit: (id: string) => Promise<{ ok: true } | { ok: false; errors: F }>;
}

/**
 * Envio do wizard: guarda o id do rascunho (reenvio não duplica o rascunho, D-051-14) e trava duplo envio.
 * Após criar o rascunho, qualquer resultado leva à página do criativo .
 */
export function createWizardSubmitter<V, F extends Record<string, string[]>>(deps: WizardSubmitDeps<V, F>) {
  let draftId: string | null = null;
  let locked = false;
  return {
    get draftId() {
      return draftId;
    },
    async run(values: V): Promise<WizardSubmitOutcome<F>> {
      if (locked) return { kind: "busy" };
      locked = true;
      if (draftId === null) {
        try {
          const draft = await deps.createDraft(values);
          if (!draft.ok) {
            locked = false;
            return { kind: "draft_error", errors: draft.errors };
          }
          draftId = draft.data.id;
        } catch {
          locked = false;
          return { kind: "draft_threw" };
        }
      }
      try {
        const sent = await deps.submit(draftId);
        if (sent.ok) return { kind: "sent", id: draftId }; // trava mantida até a navegação
        locked = false;
        return { kind: "not_sent", id: draftId, errors: sent.errors };
      } catch {
        locked = false;
        return { kind: "submit_threw", id: draftId };
      }
    },
  };
}
