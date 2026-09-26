import { prisma } from "@/lib/prisma";
import type { Candidate } from "./alerts";

/**
 * SPEC-028: lembretes de reuniao como MobileAlert `meeting_reminder`. Texto FIXO por antecedencia: nunca nome, telefone, e-mail, link,
 * notes nem horario exato. `refType=meeting`, `refId=meetingId`; nenhum link no alerta.
 */
export const REMINDER_KIND = "meeting_reminder";
export const DEFAULT_OFFSETS = [1440, 60, 15];
const MAX_MEETINGS = 500;

const LABEL: Record<number, string> = { 1440: "24 horas", 120: "2 horas", 60: "1 hora", 30: "30 min", 15: "15 min", 5: "5 min" };
export const REMINDER_BODY = "Você tem uma reunião agendada. Abra o app para ver os detalhes.";
export const reminderTitle = (offsetMin: number) => `Reunião em ${LABEL[offsetMin] ?? `${offsetMin} min`}`;
export const reminderKey = (meetingId: string, startsAtMs: number, offsetMin: number) => `${REMINDER_KIND}:${meetingId}:${startsAtMs}:${offsetMin}`;

export interface ReminderCandidate extends Candidate {
  /** Nasce lido e sem push: usuario ja sabia (criou/reagendou/religou dentro da janela). */
  silent: boolean;
}

/**
 * Regras: janela aberta = `now >= startsAt - offset` e `now < startsAt`. Emite so o MENOR offset ja aberto (cron atrasado nunca emite lembrete vencido);
 * `activeKeys` traz TODOS os offsets abertos das reunioes agendadas futuras, para a varredura nao resolver o lembrete anterior.
 */
/**
 * SPEC-030: `MeetingSettings` deixou de ser singleton global (1 linha por Organization) — a varredura
 * precisa respeitar a configuração DA ORG DONA de cada reunião, nunca uma única config global.
 * `MobileAlert.orgId` agora e obrigatorio (vazamento cross-tenant corrigido nesta rodada da SPEC-030) —
 * esta funcao roda 1x por org ATIVA (chamada por `sweepOrg`, `src/lib/mobile/alerts.ts`) e so consulta
 * reunioes DAQUELA org (nunca cruza tenant).
 */
export async function collectMeetingReminders(now: Date, orgId: string): Promise<{ candidates: ReminderCandidate[]; activeKeys: string[] }> {
  const settings = await prisma.meetingSettings.findUnique({ where: { orgId } });
  const maxOff = settings ? Math.max(DEFAULT_OFFSETS[0], ...settings.offsetsMin) : DEFAULT_OFFSETS[0];
  const meetings = await prisma.meeting.findMany({
    where: { status: "scheduled", startsAt: { gt: now, lte: new Date(now.getTime() + maxOff * 60_000) }, campaign: { orgId } },
    orderBy: { startsAt: "asc" },
    take: MAX_MEETINGS,
    select: { id: true, startsAt: true, updatedAt: true },
  });
  const candidates: ReminderCandidate[] = [];
  const activeKeys: string[] = [];
  for (const m of meetings) {
    const enabled = settings?.remindersEnabled ?? true;
    const offsets = (settings ? settings.offsetsMin : DEFAULT_OFFSETS).filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
    if (!enabled || !offsets.length) continue;
    const t = m.startsAt.getTime();
    const open = offsets.filter((o) => now.getTime() >= t - o * 60_000);
    for (const o of open) activeKeys.push(reminderKey(m.id, t, o));
    if (!open.length) continue;
    const off = open[0]; // menor offset aberto
    const windowStart = t - off * 60_000;
    // Baseline: reuniao criada/editada ou configuracao ligada/alterada DENTRO da janela nao gera push retroativo.
    const silent = m.updatedAt.getTime() > windowStart || (settings ? settings.updatedAt.getTime() > windowStart : false);
    candidates.push({
      kind: REMINDER_KIND, severity: off <= 15 ? "alta" : "media", dedupeKey: reminderKey(m.id, t, off),
      title: reminderTitle(off), body: REMINDER_BODY, refType: "meeting", refId: m.id, link: null, silent,
    });
  }
  return { candidates, activeKeys };
}
