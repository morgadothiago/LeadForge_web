import type { FieldErrors } from "@/lib/actions/result";
import type {
  AvatarsAndVoices,
  CreativeAspectRatio,
  CreativeLanguage,
  CreativeStatusName,
  CreativeView,
  CreativeVoice,
} from "@/lib/creatives/types";
import { ACTIVE_CREATIVE_STATUSES } from "@/lib/creatives/types";

/**
 * SPEC-051b — lógica PURA da UI de criativos (rótulos PT-BR, estados/ações, polling, estimativas). Sem imports de
 * servidor/React: testável em node. Nenhum texto aqui revela internals (ids de provedor, chaves de blob etc.).
 */
export const STATUS_LABEL: Record<CreativeStatusName, string> = {
  draft: "Rascunho",
  queued: "Na fila",
  processing: "Gerando",
  ready: "Pronto",
  failed: "Falhou",
  canceled: "Cancelado",
};

export type StatusTone = "default" | "muted" | "destructive" | "success" | "warning";
export const STATUS_TONE: Record<CreativeStatusName, StatusTone> = {
  draft: "muted",
  queued: "warning",
  processing: "default",
  ready: "success",
  failed: "destructive",
  canceled: "muted",
};

export const LANGUAGE_LABEL: Record<CreativeLanguage, string> = { "pt-BR": "Português (Brasil)", en: "Inglês" };
export const ASPECT_LABEL: Record<CreativeAspectRatio, { name: string; hint: string }> = {
  "9:16": { name: "Vertical (9:16)", hint: "Stories, Reels e TikTok" },
  "16:9": { name: "Horizontal (16:9)", hint: "YouTube, site e e-mail" },
  "1:1": { name: "Quadrado (1:1)", hint: "Feed e anúncios" },
};

export const isActiveStatus = (s: CreativeStatusName): boolean => (ACTIVE_CREATIVE_STATUSES as readonly string[]).includes(s);
export const isTerminalStatus = (s: CreativeStatusName): boolean => !isActiveStatus(s);

/** Ações habilitadas por estado (contrato 051a, "Estados do criativo e acoes habilitadas"). */
export interface CreativeActions {
  submit: boolean;
  cancel: boolean;
  retry: boolean;
  delete: boolean;
  play: boolean;
}
export function actionsFor(status: CreativeStatusName): CreativeActions {
  return {
    submit: status === "draft",
    cancel: isActiveStatus(status),
    retry: status === "failed" || status === "canceled",
    delete: true,
    play: status === "ready",
  };
}

/** Polling leve: só enquanto ativo; ~6 s, dobrando (até 20 s) após falhas consecutivas de rede/servidor. */
export const POLL_BASE_MS = 6000;
export const POLL_MAX_MS = 20_000;
export function shouldPoll(status: CreativeStatusName): boolean {
  return isActiveStatus(status);
}
export function nextPollDelay(consecutiveErrors: number): number {
  return Math.min(POLL_MAX_MS, POLL_BASE_MS * 2 ** Math.max(0, consecutiveErrors));
}

/** URL SAS curta: renova 30 s antes de expirar (mínimo 5 s). */
export function urlRefreshDelayMs(expiresInSeconds: number): number {
  return Math.max(5000, (expiresInSeconds - 30) * 1000);
}

/** Mesma heurística do backend (~2,5 palavras/s): só uma ESTIMATIVA exibida ao usuário; o servidor valida. */
export function estimateDurationSec(script: string): number {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  return words === 0 ? 0 : Math.max(1, Math.ceil(words / 2.5));
}
export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m} min ${String(s).padStart(2, "0")} s` : `${s} s`;
}
export function formatCents(cents: number | null | undefined): string {
  return ((cents ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export const isMockProvider = (provider: string | null | undefined): boolean => provider === "mock";
export const MOCK_LABEL = "Provedor de demonstração (mock)";
export const MOCK_NOTICE = "Os vídeos gerados são apenas placeholders de demonstração, não criativos reais. Nenhum custo é cobrado.";

export interface QuotaSummary {
  monthRemaining: number;
  concurrentRemaining: number;
  blockedReason: string | null;
}
export function quotaSummary(info: Pick<AvatarsAndVoices, "limits" | "usage">): QuotaSummary {
  const monthRemaining = Math.max(0, info.limits.maxPerMonthPerOrg - info.usage.usedThisMonth);
  const concurrentRemaining = Math.max(0, info.limits.maxConcurrentJobsPerOrg - info.usage.activeNow);
  const blockedReason =
    monthRemaining === 0
      ? "A cota mensal de criativos da sua organização foi atingida."
      : concurrentRemaining === 0
        ? "Você já tem o máximo de criativos sendo gerados ao mesmo tempo. Aguarde a conclusão de algum."
        : null;
  return { monthRemaining, concurrentRemaining, blockedReason };
}

export const voicesFor = (voices: CreativeVoice[], language: CreativeLanguage): CreativeVoice[] => voices.filter((v) => v.language === language);
export const GENDER_LABEL = { female: "feminina", male: "masculina" } as const;

/** Passos do fluxo e campos validados em cada um (RHF `trigger`). */
export const WIZARD_STEPS = [
  { key: "script", label: "Roteiro", fields: ["title", "script"] },
  { key: "avatar", label: "Avatar", fields: ["avatarRef"] },
  { key: "voice", label: "Voz e idioma", fields: ["language", "voiceRef"] },
  { key: "format", label: "Formato", fields: ["aspectRatio"] },
  { key: "review", label: "Revisão", fields: [] },
] as const;
export type WizardFieldName = "title" | "script" | "avatarRef" | "language" | "voiceRef" | "aspectRatio";

/** Passo (índice) do primeiro campo com erro vindo do servidor; -1 se nenhum. */
export function stepOfFirstError(errors: FieldErrors): number {
  let best = -1;
  for (const key of Object.keys(errors)) {
    const idx = WIZARD_STEPS.findIndex((s) => (s.fields as readonly string[]).includes(key));
    if (idx >= 0 && (best === -1 || idx < best)) best = idx;
  }
  return best;
}

/** Parâmetros de URL da biblioteca -> filtros validados (ignora valores inválidos). */
export interface LibraryFilters {
  status?: CreativeStatusName;
  q?: string;
}
const STATUS_VALUES = Object.keys(STATUS_LABEL);
export function parseLibraryFilters(sp: { status?: string | string[]; q?: string | string[] }): LibraryFilters {
  const status = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const qRaw = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  const q = qRaw?.trim().slice(0, 120);
  return {
    ...(status && STATUS_VALUES.includes(status) ? { status: status as CreativeStatusName } : {}),
    ...(q ? { q } : {}),
  };
}
export function filtersToQuery(f: LibraryFilters): string {
  const p = new URLSearchParams();
  if (f.status) p.set("status", f.status);
  if (f.q) p.set("q", f.q);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Texto de progresso exibido (progressPct pode ser nulo). */
export function progressLabel(c: Pick<CreativeView, "status" | "job">): string {
  if (c.status === "queued") return "Aguardando na fila de geração.";
  if (c.status === "processing") return c.job?.progressPct != null ? `Gerando o vídeo… ${Math.round(c.job.progressPct)}%` : "Gerando o vídeo…";
  return "";
}

export function aspectClass(r: CreativeAspectRatio): string {
  return r === "9:16" ? "aspect-[9/16]" : r === "16:9" ? "aspect-video" : "aspect-square";
}
