import { CALENDAR_TZ, dayKeyOf, formatMinutes, instantAt, minutesOfDay } from "./tz";

export const STEP_MIN = 15;
export const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "America/Sao_Paulo", label: "Brasília (GMT-3)" },
  { value: "America/Manaus", label: "Manaus (GMT-4)" },
  { value: "America/Rio_Branco", label: "Rio Branco (GMT-5)" },
  { value: "America/Noronha", label: "Fernando de Noronha (GMT-2)" },
  { value: "UTC", label: "UTC" },
];
export const MEETING_STATUS_LABELS: Record<string, string> = { scheduled: "Agendada", done: "Realizada", no_show: "No-show", cancelled: "Cancelada" };

/** Opcoes de horario de 15 em 15 min; inclui `extra` (horario fora da grade de uma reuniao vinda de integracao). */
export function timeOptions(from: number, to: number, extra?: number): number[] {
  const out: number[] = [];
  for (let m = from; m <= to; m += STEP_MIN) out.push(m);
  if (extra !== undefined && extra >= from && extra <= to && !out.includes(extra)) out.push(extra);
  return out.sort((a, b) => a - b);
}
export const timeLabel = (min: number) => (min >= 1440 ? "00:00 (dia seguinte)" : formatMinutes(min));

export interface FormValues { dateKey: string; startMin: number; endMin: number; timezone: string; link: string; notes: string; opportunityId: string }

export function initialValues(dateKey: string): FormValues {
  return { dateKey, startMin: 10 * 60, endMin: 10 * 60 + 30, timezone: CALENDAR_TZ, link: "", notes: "", opportunityId: "" };
}
export function valuesFromMeeting(m: { startsAt: Date; endsAt: Date; durationMin: number; timezone: string; link: string | null; notes: string | null; opportunityId: string }): FormValues {
  const startMin = minutesOfDay(m.startsAt, m.timezone);
  return { dateKey: dayKeyOf(m.startsAt, m.timezone), startMin, endMin: Math.min(startMin + m.durationMin, 1440), timezone: m.timezone, link: m.link ?? "", notes: m.notes ?? "", opportunityId: m.opportunityId };
}

export function toPayload(v: FormValues) {
  const startsAt = instantAt(v.dateKey, v.startMin, v.timezone);
  return { startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + (v.endMin - v.startMin) * 60_000), durationMin: v.endMin - v.startMin };
}

export type FormErrors = Partial<Record<"opportunityId" | "dateKey" | "endMin" | "link" | "notes", string>>;
export function validate(v: FormValues, mode: "create" | "edit"): FormErrors {
  const e: FormErrors = {};
  if (mode === "create" && !v.opportunityId) e.opportunityId = "Selecione um lead e sua oportunidade.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.dateKey)) e.dateKey = "Informe a data.";
  if (v.endMin <= v.startMin) e.endMin = "O fim deve ser depois do início.";
  if (v.link.trim() && !/^https:\/\/\S+$/.test(v.link.trim())) e.link = "O link deve começar com https://.";
  if (v.notes.length > 2000) e.notes = "Observações devem ter no máximo 2000 caracteres.";
  return e;
}
