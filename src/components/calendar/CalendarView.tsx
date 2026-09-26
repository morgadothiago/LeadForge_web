"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { MEETING_STATUS_LABELS } from "@/lib/calendar/form";
import { layoutLanes } from "@/lib/calendar/layout";
import {
  CALENDAR_TZ, dayKeyOf, formatDayLong, formatDayShort, formatTime, formatWeekday, groupByDay, keyOf, minutesOfDay, monthGridKeys, shiftDate, viewTitle, visibleRange, weekKeys,
  type CalendarView as View, type Segment,
} from "@/lib/calendar/tz";
import { cn } from "@/lib/utils";
import { MeetingDialog, type DialogState } from "./MeetingDialog";
import { parseMeeting, type CalendarMeeting, type ParsedMeeting } from "./types";

const HOUR_PX = 48;
const VIEWS: { id: View; label: string }[] = [
  { id: "month", label: "Mês" },
  { id: "week", label: "Semana" },
  { id: "day", label: "Dia" },
];
const hrefFor = (view: View, date: string) => `/calendario?view=${view}&date=${date}`;

export interface CalendarViewProps { view: View; dateKey: string; todayKey: string; meetings: CalendarMeeting[]; error?: string | null; openMeetingId?: string | null }

function gmtLabel(dateKey: string): string {
  const inst = new Date(`${dateKey}T15:00:00Z`);
  const p = new Intl.DateTimeFormat("en-US", { timeZone: CALENDAR_TZ, timeZoneName: "shortOffset" }).formatToParts(inst).find((x) => x.type === "timeZoneName");
  return p?.value ?? "GMT-3";
}

function blockCls(m: ParsedMeeting, now: number | null) {
  const past = now !== null && m.endsAt.getTime() < now;
  return cn(
    "border-l-2 border-primary bg-primary/15 text-foreground hover:bg-primary/25",
    m.status === "cancelled" && "border-muted-foreground bg-muted/40 line-through opacity-50",
    (m.status === "done" || m.status === "no_show") && "opacity-70",
    past && m.status === "scheduled" && "opacity-60",
  );
}
const meetingLabel = (m: ParsedMeeting) =>
  `${formatTime(m.startsAt)} ${m.leadName}${m.company ? `, ${m.company}` : ""}, ${MEETING_STATUS_LABELS[m.status] ?? m.status}`;

export function CalendarView({ view, dateKey, todayKey, meetings, error, openMeetingId }: CalendarViewProps) {
  const router = useRouter();
  const parsed = React.useMemo(() => meetings.map(parseMeeting), [meetings]);
  const [dialog, setDialog] = React.useState<DialogState>(() => {
    const m = openMeetingId ? parsed.find((x) => x.id === openMeetingId) : undefined;
    return m ? { mode: "edit", meeting: m } : null;
  });
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    const tick = () => setNow(Date.now());
    const t0 = setTimeout(tick, 0);
    const t = setInterval(tick, 60_000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, []);

  const range = React.useMemo(() => visibleRange(view, dateKey), [view, dateKey]);
  const byDay = React.useMemo(() => groupByDay(parsed, range.days), [parsed, range.days]);
  const open = (m: ParsedMeeting) => setDialog({ mode: "edit", meeting: m });
  const active = dialog?.mode === "edit" ? parsed.find((m) => m.id === dialog.meeting.id) ?? dialog.meeting : null;
  const dialogState: DialogState = dialog?.mode === "edit" && active ? { mode: "edit", meeting: active } : dialog;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Link href={hrefFor(view, shiftDate(view, dateKey, -1))} aria-label="Período anterior" className={buttonVariants({ variant: "outline", size: "icon" })}>
            <ChevronLeft aria-hidden="true" />
          </Link>
          <Link href={hrefFor(view, shiftDate(view, dateKey, 1))} aria-label="Próximo período" className={buttonVariants({ variant: "outline", size: "icon" })}>
            <ChevronRight aria-hidden="true" />
          </Link>
          <Link href={hrefFor(view, todayKey)} className={buttonVariants({ variant: "outline" })}>Hoje</Link>
        </div>
        <h2 className="min-w-0 flex-1 truncate font-heading text-base font-semibold sm:text-lg" aria-live="polite">{viewTitle(view, dateKey)}</h2>
        <nav aria-label="Modo de visualização" className="flex rounded-md border border-border p-0.5">
          {VIEWS.map((v) => (
            <Link
              key={v.id}
              href={hrefFor(v.id, dateKey)}
              aria-current={v.id === view ? "page" : undefined}
              className={cn("inline-flex h-8 items-center rounded px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary/40", v.id === view ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground")}
            >
              {v.label}
            </Link>
          ))}
        </nav>
        <div className="relative">
          <Button variant="outline" size="icon" aria-label="Escolher data" aria-expanded={pickerOpen} aria-haspopup="dialog" onClick={() => setPickerOpen((o) => !o)}>
            <CalendarDays aria-hidden="true" />
          </Button>
          {pickerOpen ? (
            <div role="dialog" aria-label="Escolher data" className="absolute right-0 z-30 mt-2 rounded-lg border border-border bg-popover shadow-xl" onKeyDown={(e) => e.key === "Escape" && setPickerOpen(false)}>
              <Calendar
                mode="single"
                selected={new Date(`${dateKey}T12:00:00`)}
                defaultMonth={new Date(`${dateKey}T12:00:00`)}
                onSelect={(d) => {
                  if (!d) return;
                  setPickerOpen(false);
                  router.push(hrefFor(view, keyOf(d.getFullYear(), d.getMonth() + 1, d.getDate())));
                }}
              />
            </div>
          ) : null}
        </div>
        <Button onClick={() => setDialog({ mode: "create", dateKey })}>
          <Plus aria-hidden="true" />
          Nova reunião
        </Button>
      </div>

      {error ? <p role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm">{error}</p> : null}

      <AgendaList days={range.days} byDay={byDay} view={view} dateKey={dateKey} now={now} onOpen={open} />
      <div className="hidden sm:block">
        {view === "month" ? <MonthView dateKey={dateKey} todayKey={todayKey} byDay={byDay} now={now} onOpen={open} /> : <TimeGrid days={view === "week" ? weekKeys(dateKey) : [dateKey]} todayKey={todayKey} byDay={byDay} now={now} onOpen={open} />}
      </div>

      <MeetingDialog state={dialogState} meetings={parsed} onClose={() => setDialog(null)} />
    </div>
  );
}

type ByDay = ReturnType<typeof groupByDay<ParsedMeeting>>;

function MonthView({ dateKey, todayKey, byDay, now, onOpen }: { dateKey: string; todayKey: string; byDay: ByDay; now: number | null; onOpen: (m: ParsedMeeting) => void }) {
  const days = monthGridKeys(dateKey);
  return (
    <div role="grid" aria-label={viewTitle("month", dateKey)} data-view="month" className="overflow-hidden rounded-lg border border-border">
      <div role="row" className="grid grid-cols-7 border-b border-border bg-muted/30">
        {weekKeys(days[0]).map((k) => (
          <div key={k} role="columnheader" className="px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">{formatWeekday(k)}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((k, i) => {
          const items = byDay.get(k) ?? [];
          const inMonth = k.slice(0, 7) === dateKey.slice(0, 7);
          return (
            <div key={k} role="gridcell" data-day={k} className={cn("min-h-24 min-w-0 space-y-1 border-border p-1.5", i % 7 !== 6 && "border-r", i < 35 && "border-b", !inMonth && "bg-muted/20")}>
              <Link
                href={hrefFor("day", k)}
                aria-label={formatDayLong(k)}
                aria-current={k === todayKey ? "date" : undefined}
                className={cn("inline-flex size-6 items-center justify-center rounded-full text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary/40", k === todayKey ? "bg-primary font-bold text-primary-foreground" : inMonth ? "text-foreground hover:bg-accent" : "text-muted-foreground hover:bg-accent")}
              >
                {Number(k.slice(8))}
              </Link>
              {items.slice(0, 3).map(({ item }) => (
                <button key={item.id} type="button" onClick={() => onOpen(item)} aria-label={meetingLabel(item)} className={cn("flex w-full min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary/40", blockCls(item, now))}>
                  <span className="shrink-0 tabular-nums">{formatTime(item.startsAt)}</span>
                  <span className="truncate">{item.leadName}</span>
                </button>
              ))}
              {items.length > 3 ? (
                <Link href={hrefFor("day", k)} className="block px-1.5 text-xs text-muted-foreground hover:text-foreground">+{items.length - 3} mais<span className="sr-only"> em {formatDayLong(k)}</span></Link>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimeGrid({ days, todayKey, byDay, now, onOpen }: { days: string[]; todayKey: string; byDay: ByDay; now: number | null; onOpen: (m: ParsedMeeting) => void }) {
  const scroller = React.useRef<HTMLDivElement>(null);
  const firstDay = days[0];
  React.useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 7 * HOUR_PX;
  }, [firstDay]);
  const cols = `3.5rem repeat(${days.length}, minmax(0, 1fr))`;
  const nowMin = now === null ? null : minutesOfDay(new Date(now));
  const nowKey = now === null ? null : dayKeyOf(new Date(now));
  return (
    <div data-view={days.length === 1 ? "day" : "week"} className="overflow-hidden rounded-lg border border-border">
      <div className="grid border-b border-border bg-muted/30" style={{ gridTemplateColumns: cols }}>
        <div className="px-1 py-2 text-center text-[10px] text-muted-foreground">{gmtLabel(days[0])}</div>
        {days.map((k) => (
          <Link key={k} href={hrefFor("day", k)} aria-current={k === todayKey ? "date" : undefined} className={cn("px-2 py-2 text-center text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary/40", k === todayKey ? "text-primary" : "text-muted-foreground")}>
            {days.length === 1 ? formatDayShort(k) : `${formatWeekday(k)} ${Number(k.slice(8))}`}
          </Link>
        ))}
      </div>
      <div ref={scroller} className="max-h-[68svh] overflow-y-auto" tabIndex={0} aria-label="Grade de horários (00:00 a 24:00)" role="region">
        <div className="relative grid" style={{ gridTemplateColumns: cols, height: 24 * HOUR_PX }}>
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground" style={{ top: h * HOUR_PX }} aria-hidden={h === 0 ? "true" : undefined}>
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>
          {days.map((k) => {
            const entries = byDay.get(k) ?? [];
            const lanes = layoutLanes(entries.map((e) => e.seg));
            return (
              <div key={k} data-day={k} className="relative border-l border-border" style={{ backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, var(--border) ${HOUR_PX - 1}px, var(--border) ${HOUR_PX}px)` }}>
                {entries.map(({ item, seg }, i) => (
                  <Block key={`${item.id}-${k}`} item={item} seg={seg} lane={lanes[i]} now={now} onOpen={onOpen} />
                ))}
                {nowKey === k && nowMin !== null ? (
                  <div aria-hidden="true" data-slot="now-line" className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: (nowMin / 60) * HOUR_PX }}>
                    <span className="-ml-1 size-2 rounded-full bg-destructive" />
                    <span className="h-px flex-1 bg-destructive" />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Block({ item, seg, lane, now, onOpen }: { item: ParsedMeeting; seg: Segment; lane: { lane: number; lanes: number }; now: number | null; onOpen: (m: ParsedMeeting) => void }) {
  const top = (seg.startMin / 60) * HOUR_PX;
  const height = Math.max(((seg.endMin - seg.startMin) / 60) * HOUR_PX - 2, 20);
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      aria-label={meetingLabel(item)}
      className={cn("absolute overflow-hidden rounded px-1.5 py-0.5 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary/60", blockCls(item, now))}
      style={{ top, height, left: `calc(${(lane.lane / lane.lanes) * 100}% + 2px)`, width: `calc(${100 / lane.lanes}% - 4px)` }}
    >
      <span className="block truncate font-medium">{item.leadName}</span>
      <span className="block truncate tabular-nums text-muted-foreground">{formatTime(item.startsAt)}–{formatTime(item.endsAt)}</span>
    </button>
  );
}

/** Agenda/lista: unica vista em telas < 640px (sm:hidden); em telas maiores as grades assumem. */
function AgendaList({ days, byDay, view, dateKey, now, onOpen }: { days: string[]; byDay: ByDay; view: View; dateKey: string; now: number | null; onOpen: (m: ParsedMeeting) => void }) {
  const shown = days.filter((k) => (view !== "month" || k.slice(0, 7) === dateKey.slice(0, 7)) && (byDay.get(k)?.length ?? 0) > 0);
  return (
    <section aria-label="Agenda" data-view="agenda" className="space-y-4 sm:hidden">
      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nenhuma reunião neste período.</p>
      ) : (
        shown.map((k) => (
          <div key={k} className="space-y-2">
            <h3 className="text-sm font-semibold">{formatDayLong(k)}</h3>
            <ul className="space-y-2">
              {(byDay.get(k) ?? []).map(({ item }) => (
                <li key={`${item.id}-${k}`}>
                  <button type="button" onClick={() => onOpen(item)} className={cn("flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/60", blockCls(item, now))}>
                    <span className="tabular-nums font-medium">{formatTime(item.startsAt)}–{formatTime(item.endsAt)} · {MEETING_STATUS_LABELS[item.status] ?? item.status}</span>
                    <span>{item.leadName}{item.company ? <span className="text-muted-foreground"> · {item.company}</span> : null}</span>
                    <span className="text-xs text-muted-foreground">{item.campaignName}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
