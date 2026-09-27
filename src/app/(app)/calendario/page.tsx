import { CalendarView } from "@/components/calendar/CalendarView";
import type { CalendarMeeting } from "@/components/calendar/types";
import { requirePageUser } from "@/lib/auth/require-page";
import { dayKeyOf, isDayKey, visibleRange, type CalendarView as View } from "@/lib/calendar/tz";
import { getMeetingStart, listMeetings } from "@/lib/queries/meetings";

export const dynamic = "force-dynamic";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageUser();
  const sp = await searchParams;
  const todayKey = dayKeyOf(new Date());
  const rawView = first(sp.view);
  const view: View = rawView === "week" || rawView === "day" ? rawView : rawView === "month" ? "month" : "week";
  const meetingParam = first(sp.meeting);
  const rawDate = first(sp.date);
  let dateKey = isDayKey(rawDate) ? rawDate : null;
  if (!dateKey && meetingParam) {
    const start = await getMeetingStart(meetingParam);
    if (start) dateKey = dayKeyOf(start);
  }
  dateKey ??= todayKey;

  const range = visibleRange(view, dateKey);
  const result = await listMeetings({ from: range.from, to: range.to });
  const meetings: CalendarMeeting[] = result.ok ? result.items.map((m) => ({ ...m, startsAt: m.startsAt.toISOString(), endsAt: m.endsAt.toISOString() })) : [];
  return (
    <CalendarView
      key={`${view}-${dateKey}`}
      view={view}
      dateKey={dateKey}
      todayKey={todayKey}
      meetings={meetings}
      error={result.ok ? null : result.error}
      openMeetingId={meetingParam ?? null}
    />
  );
}
