/** Reuniao serializada do servidor para o cliente (datas em ISO). */
export interface CalendarMeeting {
  id: string; opportunityId: string; leadId: string; leadName: string; company: string | null; campaignId: string; campaignName: string;
  startsAt: string; endsAt: string; durationMin: number; timezone: string; status: string; link: string | null; notes: string | null; source: string;
}
export interface ParsedMeeting extends Omit<CalendarMeeting, "startsAt" | "endsAt"> { startsAt: Date; endsAt: Date }
export const parseMeeting = (m: CalendarMeeting): ParsedMeeting => ({ ...m, startsAt: new Date(m.startsAt), endsAt: new Date(m.endsAt) });
