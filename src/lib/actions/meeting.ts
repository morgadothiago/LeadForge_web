"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireProviderOrg } from "@/lib/auth/require-admin";
import {
  createMeeting as createMeetingDomain, transitionMeeting, updateMeeting as updateMeetingDomain, writeMeetingAudit,
  type MeetingConflict, type MeetingErr, type MeetingTransition,
} from "@/lib/domain/meeting";
import { createMeetingSchema, meetingIdSchema, meetingSettingsSchema, updateMeetingSchema } from "@/lib/schemas/meeting";
import { DEFAULT_OFFSETS } from "@/lib/mobile/meeting-reminders";
import { failure, formError, safeAction, success, zodErrors, type ActionResult } from "./result";

/** SPEC-028. Toda action: requireUser primeiro; erros PT-BR; auditoria so com ids; sem PII em logs. */
function revalidate(): void {
  revalidatePath("/calendario");
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
}

export interface MeetingView { id: string; opportunityId: string; leadId: string; campaignId: string; startsAt: string; endsAt: string; durationMin: number; timezone: string; status: string; link: string | null; notes: string | null; source: string }
export interface MeetingResult { meeting: MeetingView; conflicts: { id: string; startsAt: string; endsAt: string }[]; warning?: string }

const view = (m: { id: string; opportunityId: string; leadId: string; campaignId: string; startsAt: Date; endsAt: Date; duration: number; timezone: string; status: string; link: string | null; notes: string | null; source: string }): MeetingView => ({
  id: m.id, opportunityId: m.opportunityId, leadId: m.leadId, campaignId: m.campaignId, startsAt: m.startsAt.toISOString(), endsAt: m.endsAt.toISOString(),
  durationMin: m.duration, timezone: m.timezone, status: m.status, link: m.link, notes: m.notes, source: m.source,
});
const conf = (c: MeetingConflict[]) => c.map((x) => ({ id: x.id, startsAt: x.startsAt.toISOString(), endsAt: x.endsAt.toISOString() }));

function domainError<T>(e: MeetingErr): ActionResult<T> {
  if (e.status === "invalid") return failure({ [e.field]: [e.message] });
  if (e.status === "not_found") return formError("Reunião ou oportunidade não encontrada.");
  return formError("O quadro foi alterado por outra ação. Tente novamente.");
}

/** Cria reuniao (manual). `clientRequestId` evita duplicar no duplo clique. Move a oportunidade para "Reunião Agendada". Conflito de horario = aviso em `conflicts`. */
export async function createMeeting(input: unknown): Promise<ActionResult<MeetingResult>> {
  return safeAction(async () => {
    const { user, orgId } = await requireProviderOrg();
    const p = createMeetingSchema.safeParse(input);
    if (!p.success) return failure(zodErrors(p.error));
    const d = p.data;
    const r = await createMeetingDomain({
      opportunityId: d.opportunityId, startsAt: d.startsAt, durationMin: d.durationMin, timezone: d.timezone, link: d.link ?? null, notes: d.notes ?? null,
      source: "manual", createdById: user.id, externalId: d.clientRequestId ? `client:${d.clientRequestId}` : null, orgId,
    });
    if (r.status !== "ok") return domainError(r);
    if (!r.replay) {
      await writeMeetingAudit("created", { meetingId: r.meeting.id, userId: user.id, source: "manual" });
      revalidate();
    }
    return success({ meeting: view(r.meeting), conflicts: conf(r.conflicts) });
  });
}

export async function updateMeeting(input: unknown): Promise<ActionResult<MeetingResult>> {
  return safeAction(async () => {
    const { user, orgId } = await requireProviderOrg();
    const p = updateMeetingSchema.safeParse(input);
    if (!p.success) return failure(zodErrors(p.error));
    const d = p.data;
    const r = await updateMeetingDomain({ id: d.id, startsAt: d.startsAt, durationMin: d.durationMin, timezone: d.timezone, link: d.link, notes: d.notes, orgId });
    if (r.status !== "ok") return domainError(r);
    await writeMeetingAudit("updated", { meetingId: r.meeting.id, userId: user.id });
    revalidate();
    return success({ meeting: view(r.meeting), conflicts: conf(r.conflicts) });
  });
}

async function transition(userId: string, orgId: string, input: unknown, t: MeetingTransition): Promise<ActionResult<MeetingResult>> {
  const p = meetingIdSchema.safeParse(input);
  if (!p.success) return failure(zodErrors(p.error));
  const r = await transitionMeeting(p.data.id, t, new Date(), orgId);
  if (r.status !== "ok") return domainError(r);
  await writeMeetingAudit(t, { meetingId: r.meeting.id, userId });
  revalidate();
  return success({ meeting: view(r.meeting), conflicts: [], ...(r.warning ? { warning: r.warning } : {}) });
}

/** Cancelar NAO desfaz o stage da oportunidade: devolve `warning` para a UI. */
export async function cancelMeeting(input: unknown): Promise<ActionResult<MeetingResult>> {
  return safeAction(async () => {
    const { user, orgId } = await requireProviderOrg();
    return transition(user.id, orgId, input, "cancel");
  });
}
export async function markMeetingDone(input: unknown): Promise<ActionResult<MeetingResult>> {
  return safeAction(async () => {
    const { user, orgId } = await requireProviderOrg();
    return transition(user.id, orgId, input, "done");
  });
}
export async function markMeetingNoShow(input: unknown): Promise<ActionResult<MeetingResult>> {
  return safeAction(async () => {
    const { user, orgId } = await requireProviderOrg();
    return transition(user.id, orgId, input, "no_show");
  });
}

export interface MeetingSettingsView { remindersEnabled: boolean; offsetsMin: number[] }

export async function getMeetingSettings(): Promise<ActionResult<MeetingSettingsView>> {
  return safeAction(async () => {
    const { orgId } = await requireProviderOrg();
    const s = await prisma.meetingSettings.findUnique({ where: { orgId } });
    return success({ remindersEnabled: s?.remindersEnabled ?? true, offsetsMin: s?.offsetsMin ?? DEFAULT_OFFSETS });
  });
}

/** Configurações de lembretes de reunião DESTA org (SPEC-030: deixou de ser singleton global). */
export async function saveMeetingSettings(input: unknown): Promise<ActionResult<MeetingSettingsView>> {
  return safeAction(async () => {
    const { user, orgId } = await requireProviderOrg();
    const p = meetingSettingsSchema.safeParse(input);
    if (!p.success) return failure(zodErrors(p.error));
    const s = await prisma.meetingSettings.upsert({
      where: { orgId },
      create: { orgId, ...p.data },
      update: p.data,
    });
    await writeMeetingAudit("settings_saved", { meetingId: orgId, userId: user.id });
    return success({ remindersEnabled: s.remindersEnabled, offsetsMin: s.offsetsMin });
  });
}
