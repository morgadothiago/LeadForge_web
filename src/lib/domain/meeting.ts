import { Prisma, type Meeting, type MeetingSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isRetryableTxConflict, withSerializableRetry } from "@/lib/db/tx-conflict";
import { REMINDER_KIND } from "@/lib/mobile/meeting-reminders";
import { moveOpportunityInTx } from "./move-opportunity";
import { DEFAULT_TIMEZONE, MEETING_MAX_DURATION, MEETING_MIN_DURATION, isValidTimezone } from "@/lib/schemas/meeting";

/**
 * SPEC-028: dominio de reunioes. Sem auth/revalidate (quem chama cuida). UTC no banco.
 * Sobreposicao de horario e SO AVISO (D-R8). Cancelar nao desfaz o stage: devolve aviso.
 */
export const MEETING_STAGE = "reuniao_agendada" as const;
export const AUDIT_SOURCE = "meeting";

export interface MeetingConflict { id: string; startsAt: Date; endsAt: Date }

export type MeetingErr = { status: "invalid"; field: string; message: string } | { status: "not_found" } | { status: "conflict" };

export interface ScheduleInput { startsAt: Date; durationMin: number; link?: string | null; timezone?: string }

/** Validacoes puras (fim > inicio, duracao 5..480, https, fuso IANA, futuro quando exigido). */
export function validateSchedule(i: ScheduleInput, now: Date, requireFuture: boolean): MeetingErr | null {
  if (Number.isNaN(i.startsAt.getTime())) return { status: "invalid", field: "startsAt", message: "Início inválido." };
  if (!Number.isInteger(i.durationMin) || i.durationMin < MEETING_MIN_DURATION || i.durationMin > MEETING_MAX_DURATION)
    return { status: "invalid", field: "durationMin", message: `Duração deve ficar entre ${MEETING_MIN_DURATION} e ${MEETING_MAX_DURATION} minutos.` };
  if (endsAtOf(i.startsAt, i.durationMin) <= i.startsAt) return { status: "invalid", field: "startsAt", message: "O fim deve ser posterior ao início." };
  if (i.link && !/^https:\/\/\S+$/.test(i.link)) return { status: "invalid", field: "link", message: "Link deve começar com https://." };
  if (i.timezone !== undefined && !isValidTimezone(i.timezone)) return { status: "invalid", field: "timezone", message: "Fuso horário inválido." };
  if (requireFuture && i.startsAt.getTime() <= now.getTime()) return { status: "invalid", field: "startsAt", message: "O início deve estar no futuro." };
  return null;
}

export const endsAtOf = (startsAt: Date, durationMin: number) => new Date(startsAt.getTime() + durationMin * 60_000);

/** Reunioes agendadas que se sobrepoem ao intervalo (aviso, nunca bloqueio). */
export async function findConflicts(db: Prisma.TransactionClient | typeof prisma, startsAt: Date, endsAt: Date, excludeId?: string): Promise<MeetingConflict[]> {
  return db.meeting.findMany({
    where: { status: "scheduled", startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    orderBy: { startsAt: "asc" },
    take: 20,
    select: { id: true, startsAt: true, endsAt: true },
  });
}

export async function writeMeetingAudit(action: string, data: { meetingId: string; userId?: string | null; source?: string }): Promise<void> {
  // Auditoria so com ids (sem PII); falha nunca derruba a operacao ja concluida.
  await prisma.webhookEvent.create({ data: { source: AUDIT_SOURCE, processedAt: new Date(), payload: { action, ...data, at: new Date().toISOString() } } }).catch(() => undefined);
}

/** Resolve os lembretes pendentes da reuniao (opcionalmente preservando os do startsAt vigente). */
export async function resolveMeetingAlerts(meetingId: string, now: Date, keepStartsAtMs?: number): Promise<number> {
  const r = await prisma.mobileAlert.updateMany({
    where: {
      kind: REMINDER_KIND, refId: meetingId, resolvedAt: null,
      ...(keepStartsAtMs !== undefined ? { NOT: { dedupeKey: { startsWith: `${REMINDER_KIND}:${meetingId}:${keepStartsAtMs}:` } } } : {}),
    },
    data: { resolvedAt: now },
  });
  return r.count;
}

export interface CreateMeetingParams {
  opportunityId: string;
  startsAt: Date;
  durationMin: number;
  timezone?: string;
  link?: string | null;
  notes?: string | null;
  source?: MeetingSource;
  /** Chave de idempotencia "crua" (webhook externalId / clientRequestId), ja com prefixo do CHAMADOR (ex.: "wh:", "client:"). Escopada por org internamente antes de persistir — ver `scopedExternalId`. */
  externalId?: string | null;
  createdById?: string | null;
  now?: Date;
  /**
   * SPEC-030: org dona da oportunidade. Quando informado, a oportunidade so e encontrada se
   * pertencer a esta org (defesa contra opportunityId adivinhado de outro tenant). Callers
   * internos que ja resolveram a org por outro caminho (webhook, scheduler) devem sempre passar.
   */
  orgId?: string;
}
export type CreateOutcome =
  | { status: "ok"; meeting: Meeting; conflicts: MeetingConflict[]; stageMoved: boolean; replay: boolean }
  | MeetingErr;

/**
 * SPEC-030 (fix de vazamento cross-tenant, 2026-09-26, achado do QA na Rodada 5): `Meeting.externalId`
 * e `@unique` GLOBALMENTE no schema (nao por org — ver `prisma/schema.prisma`, decisao deliberada de nao
 * desnormalizar `orgId` em `Meeting`, que resolve tenant via `Campaign`, ver secao "Modelo de dados" do
 * spec). Antes desta correcao, a checagem de idempotencia comparava o `externalId` CRU do chamador
 * (ex.: `"wh:abc"`, o mesmo prefixo estatico para toda a plataforma) contra a tabela inteira, sem
 * nenhum filtro de org — uma Organization B podia reaproveitar/adivinhar um `externalId` ja usado pela
 * Organization A e receber de volta a reuniao da A como "replay" (`idempotentReplay: true`), mesmo
 * enviando `campaignId`/`leadId` legitimos da propria B. Correcao (opcao (b) do achado, escolhida em vez
 * de desnormalizar `orgId` em `Meeting` porque o spec ja diz explicitamente que essa tabela NAO deve
 * ganhar `orgId` proprio): o valor persistido/consultado em `Meeting.externalId` deixa de ser o
 * `externalId` puro do chamador e passa a ser `scopedExternalId(orgId, externalId)`, prefixado com o
 * `orgId` REAL da oportunidade (nao mais uma constante estatica) — resolvido a partir da propria
 * `opportunityId` antes de qualquer checagem de idempotencia (nao depende do chamador lembrar de passar
 * `orgId` certo; se passar, so serve como defesa em profundidade extra). Duas Organizations nunca mais
 * colidem no mesmo `externalId` cru, porque a string armazenada e diferente.
 */
export function scopedExternalId(orgId: string, externalId: string): string {
  return `org:${orgId}:${externalId}`;
}

export async function createMeeting(p: CreateMeetingParams): Promise<CreateOutcome> {
  const now = p.now ?? new Date();
  // Resolve a org REAL da oportunidade antes de qualquer coisa (inclusive antes da checagem de
  // idempotencia) — nunca confia so no p.orgId opcional do chamador para escopar o externalId.
  const oppOrg = await prisma.opportunity.findUnique({ where: { id: p.opportunityId }, select: { campaign: { select: { orgId: true } } } });
  if (!oppOrg) return { status: "not_found" };
  const orgId = oppOrg.campaign.orgId;
  if (p.orgId && orgId !== p.orgId) return { status: "not_found" };
  const externalKey = p.externalId ? scopedExternalId(orgId, p.externalId) : null;
  if (externalKey) {
    const prev = await prisma.meeting.findUnique({ where: { externalId: externalKey } });
    if (prev) return { status: "ok", meeting: prev, conflicts: [], stageMoved: false, replay: true };
  }
  const bad = validateSchedule({ startsAt: p.startsAt, durationMin: p.durationMin, link: p.link, timezone: p.timezone }, now, true);
  if (bad) return bad;
  const endsAt = endsAtOf(p.startsAt, p.durationMin);
  try {
    const out = await withSerializableRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const opp = await tx.opportunity.findUnique({
            where: { id: p.opportunityId },
            select: { id: true, leadId: true, campaignId: true, stage: true, campaign: { select: { orgId: true } } },
          });
          if (!opp) return null;
          if (p.orgId && opp.campaign.orgId !== p.orgId) return null;
          const conflicts = await findConflicts(tx, p.startsAt, endsAt);
          const meeting = await tx.meeting.create({
            data: {
              opportunityId: opp.id, leadId: opp.leadId, campaignId: opp.campaignId,
              startsAt: p.startsAt, endsAt, duration: p.durationMin, timezone: p.timezone ?? DEFAULT_TIMEZONE,
              link: p.link ?? null, notes: p.notes ?? null, source: p.source ?? "manual",
              externalId: externalKey, createdById: p.createdById ?? null,
            },
          });
          let stageMoved = false;
          if (opp.stage !== MEETING_STAGE) {
            const moved = await moveOpportunityInTx(tx, { opportunityId: opp.id, toStage: MEETING_STAGE, toIndex: Number.MAX_SAFE_INTEGER });
            stageMoved = !!moved?.changed;
          }
          return { meeting, conflicts, stageMoved };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
    if (!out) return { status: "not_found" };
    return { status: "ok", ...out, replay: false };
  } catch (e) {
    if (isRetryableTxConflict(e)) return { status: "conflict" };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && externalKey) {
      const prev = await prisma.meeting.findUnique({ where: { externalId: externalKey } });
      if (prev) return { status: "ok", meeting: prev, conflicts: [], stageMoved: false, replay: true };
    }
    throw e;
  }
}

export interface UpdateMeetingParams {
  id: string;
  startsAt?: Date;
  durationMin?: number;
  timezone?: string;
  link?: string | null;
  notes?: string | null;
  now?: Date;
  /** SPEC-030: quando informado, a reuniao so e encontrada se a campanha dona pertencer a esta org. */
  orgId?: string;
}
export type UpdateOutcome = { status: "ok"; meeting: Meeting; conflicts: MeetingConflict[] } | MeetingErr;

/** Edita reuniao AGENDADA. Reagendar exige futuro e resolve os lembretes do horario antigo (os novos nascem na varredura). */
export async function updateMeeting(p: UpdateMeetingParams): Promise<UpdateOutcome> {
  const now = p.now ?? new Date();
  const cur = p.orgId
    ? await prisma.meeting.findFirst({ where: { id: p.id, campaign: { orgId: p.orgId } } })
    : await prisma.meeting.findUnique({ where: { id: p.id } });
  if (!cur) return { status: "not_found" };
  if (cur.status !== "scheduled") return { status: "invalid", field: "_form", message: "Só é possível editar reuniões agendadas." };
  const startsAt = p.startsAt ?? cur.startsAt;
  const durationMin = p.durationMin ?? cur.duration;
  const link = p.link !== undefined ? p.link : cur.link;
  const rescheduled = startsAt.getTime() !== cur.startsAt.getTime();
  const bad = validateSchedule({ startsAt, durationMin, link, timezone: p.timezone }, now, rescheduled);
  if (bad) return bad;
  const endsAt = endsAtOf(startsAt, durationMin);
  const meeting = await prisma.meeting.update({
    where: { id: cur.id },
    data: { startsAt, endsAt, duration: durationMin, link, ...(p.timezone ? { timezone: p.timezone } : {}), ...(p.notes !== undefined ? { notes: p.notes } : {}) },
  });
  if (rescheduled) await resolveMeetingAlerts(cur.id, now, startsAt.getTime());
  return { status: "ok", meeting, conflicts: await findConflicts(prisma, startsAt, endsAt, cur.id) };
}

export type MeetingTransition = "cancel" | "done" | "no_show";
export type TransitionOutcome = { status: "ok"; meeting: Meeting; warning?: string } | MeetingErr;

export const CANCEL_STAGE_WARNING = "Reunião cancelada. A oportunidade continua na etapa “Reunião Agendada”; mova-a manualmente se necessário.";

/** Transicoes so a partir de `scheduled` (idempotente se ja estiver no estado pedido). Cancelar resolve lembretes e NAO move o stage. */
export async function transitionMeeting(id: string, t: MeetingTransition, now: Date = new Date(), orgId?: string): Promise<TransitionOutcome> {
  const cur = orgId
    ? await prisma.meeting.findFirst({ where: { id, campaign: { orgId } } })
    : await prisma.meeting.findUnique({ where: { id } });
  if (!cur) return { status: "not_found" };
  const target = t === "cancel" ? "cancelled" : t;
  if (cur.status === target) return { status: "ok", meeting: cur };
  if (cur.status !== "scheduled") return { status: "invalid", field: "_form", message: "Só é possível alterar reuniões agendadas." };
  const res = await prisma.meeting.updateMany({
    where: { id, status: "scheduled" },
    data: { status: target, ...(t === "cancel" ? { cancelledAt: now } : {}) },
  });
  const meeting = await prisma.meeting.findUniqueOrThrow({ where: { id } });
  if (res.count === 0 && meeting.status !== target) return { status: "invalid", field: "_form", message: "A reunião foi alterada por outra ação. Recarregue." };
  await resolveMeetingAlerts(id, now);
  return { status: "ok", meeting, ...(t === "cancel" ? { warning: CANCEL_STAGE_WARNING } : {}) };
}
