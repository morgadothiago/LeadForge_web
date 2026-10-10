import type { CreativeAspectRatio, CreativeDetailView, CreativeFailureKind, CreativeJobStatusName, CreativeJobView, CreativeLanguage, CreativeStatusName, CreativeView } from "./types";

/** SPEC-051 — mapeia linhas do Prisma para as views publicas (nunca expõe `orgId`, `providerJobId`, `rawStatus`, `idempotencyKey`). */
export interface JobRow {
  id: string;
  runNo: number;
  status: string;
  attempts: number;
  progressPct: number | null;
  costEstimateCents: number | null;
  failureKind: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}
export interface CreativeRow {
  id: string;
  title: string;
  status: string;
  script: string;
  language: string;
  avatarRef: string;
  voiceRef: string;
  aspectRatio: string;
  durationSec: number | null;
  videoFileId: string | null;
  thumbnailFileId: string | null;
  error: string | null;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  jobs?: JobRow[];
}

export function jobView(j: JobRow): CreativeJobView {
  return {
    id: j.id,
    runNo: j.runNo,
    status: j.status as CreativeJobStatusName,
    attempts: j.attempts,
    progressPct: j.progressPct,
    costEstimateCents: j.costEstimateCents,
    failureKind: (j.failureKind as CreativeFailureKind | null) ?? null,
    errorMessage: j.errorMessage,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    createdAt: j.createdAt,
  };
}

export function creativeView(c: CreativeRow): CreativeView {
  const latest = c.jobs?.[0];
  return {
    id: c.id,
    title: c.title,
    status: c.status as CreativeStatusName,
    script: c.script,
    language: c.language as CreativeLanguage,
    avatarRef: c.avatarRef,
    voiceRef: c.voiceRef,
    aspectRatio: c.aspectRatio as CreativeAspectRatio,
    durationSec: c.durationSec,
    hasVideo: c.status === "ready" && !!c.videoFileId,
    videoFileId: c.videoFileId,
    thumbnailFileId: c.thumbnailFileId,
    error: c.error,
    submittedAt: c.submittedAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    job: latest ? jobView(latest) : null,
  };
}

export function creativeDetailView(c: CreativeRow): CreativeDetailView {
  return { ...creativeView(c), jobs: (c.jobs ?? []).map(jobView) };
}

export const JOB_SELECT = {
  id: true, runNo: true, status: true, attempts: true, progressPct: true, costEstimateCents: true, failureKind: true,
  errorMessage: true, startedAt: true, finishedAt: true, createdAt: true,
} as const;
