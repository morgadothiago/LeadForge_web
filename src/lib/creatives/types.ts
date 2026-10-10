/**
 * SPEC-051 — tipos/constantes PUROS dos criativos (sem imports de servidor: o 051b pode importar daqui no client).
 */
export const CREATIVE_STATUSES = ["draft", "queued", "processing", "ready", "failed", "canceled"] as const;
export type CreativeStatusName = (typeof CREATIVE_STATUSES)[number];

export const CREATIVE_JOB_STATUSES = ["queued", "processing", "succeeded", "failed", "canceled"] as const;
export type CreativeJobStatusName = (typeof CREATIVE_JOB_STATUSES)[number];

/** D-051-9 */
export const CREATIVE_LANGUAGES = ["pt-BR", "en"] as const;
export type CreativeLanguage = (typeof CREATIVE_LANGUAGES)[number];
export const CREATIVE_ASPECT_RATIOS = ["9:16", "16:9", "1:1"] as const;
export type CreativeAspectRatio = (typeof CREATIVE_ASPECT_RATIOS)[number];

/** Estados em que o criativo ocupa um slot de concorrencia e nao pode ser editado/reenviado. */
export const ACTIVE_CREATIVE_STATUSES = ["queued", "processing"] as const;

export type CreativeFailureKind = "provider_failed" | "provider_unavailable" | "provider_rejected" | "timeout" | "download" | "storage" | "canceled";

export interface CreativeJobView {
  id: string;
  runNo: number;
  status: CreativeJobStatusName;
  attempts: number;
  progressPct: number | null;
  costEstimateCents: number | null;
  failureKind: CreativeFailureKind | null;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

export interface CreativeView {
  id: string;
  title: string;
  status: CreativeStatusName;
  script: string;
  language: CreativeLanguage;
  avatarRef: string;
  voiceRef: string;
  aspectRatio: CreativeAspectRatio;
  durationSec: number | null;
  /** Ha video pronto no storage (use `getCreativeVideoUrl` para a URL SAS curta). */
  hasVideo: boolean;
  videoFileId: string | null;
  thumbnailFileId: string | null;
  /** Mensagem PT-BR segura do ultimo erro (status `failed`). */
  error: string | null;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Job mais recente (maior runNo); null em rascunho. */
  job: CreativeJobView | null;
}

export interface CreativeAvatar {
  id: string;
  name: string;
  previewUrl?: string;
}
export interface CreativeVoice {
  id: string;
  name: string;
  language: CreativeLanguage;
  gender?: "female" | "male";
}
export interface AvatarsAndVoices {
  provider: string;
  avatars: CreativeAvatar[];
  voices: CreativeVoice[];
  limits: { maxDurationSec: number; maxScriptChars: number; maxConcurrentJobsPerOrg: number; maxPerMonthPerOrg: number };
  /** Cota mensal ja usada pela org (criativos enviados no mes corrente, UTC). */
  usage: { usedThisMonth: number; activeNow: number };
}

export interface ListCreativesResult {
  items: CreativeView[];
  nextCursor: string | null;
}

export interface CreativeDetailView extends CreativeView {
  /** Historico de execucoes (mais recente primeiro, ate 10). */
  jobs: CreativeJobView[];
}
