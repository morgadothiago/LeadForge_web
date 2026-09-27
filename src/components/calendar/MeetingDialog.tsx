"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ExternalLink, UserX } from "lucide-react";
import { toast } from "sonner";
import { getFormError, fieldError } from "@/components/campaigns/form-utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cancelMeeting, createMeeting, markMeetingDone, markMeetingNoShow, updateMeeting, type MeetingResult } from "@/lib/actions/meeting";
import { searchMeetingLeads } from "@/lib/actions/meeting-search";
import type { ActionResult, FieldErrors } from "@/lib/actions/result";
import type { LeadOpportunityOption } from "@/lib/queries/meetings";
import {
  MEETING_STATUS_LABELS, TIMEZONE_OPTIONS, initialValues, timeLabel, timeOptions, toPayload, validate, valuesFromMeeting, type FormErrors, type FormValues,
} from "@/lib/calendar/form";
import { findConflicts, formatDayShort, formatTime } from "@/lib/calendar/tz";
import type { ParsedMeeting } from "./types";

export type DialogState = { mode: "create"; dateKey: string } | { mode: "edit"; meeting: ParsedMeeting } | null;

const nativeCls = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20 disabled:opacity-50 aria-invalid:border-destructive";
const textareaCls = "min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20 disabled:opacity-50";

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      {children}
      {error ? <p id={`${id}-error`} className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function MeetingDialog({ state, meetings, onClose }: { state: DialogState; meetings: ParsedMeeting[]; onClose: () => void }) {
  return (
    <Dialog open={state !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      {state ? (
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
          <MeetingForm key={state.mode === "edit" ? state.meeting.id : `new-${state.dateKey}`} state={state} meetings={meetings} onClose={onClose} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function MeetingForm({ state, meetings, onClose }: { state: NonNullable<DialogState>; meetings: ParsedMeeting[]; onClose: () => void }) {
  const router = useRouter();
  const edit = state.mode === "edit" ? state.meeting : null;
  const editable = !edit || edit.status === "scheduled";
  const [v, setV] = React.useState<FormValues>(() => (edit ? valuesFromMeeting(edit) : initialValues(state.mode === "create" ? state.dateKey : "")));
  const [errors, setErrors] = React.useState<FormErrors>({});
  const [serverErrors, setServerErrors] = React.useState<FieldErrors | undefined>();
  const [pending, startTransition] = React.useTransition();
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const [picked, setPicked] = React.useState<LeadOpportunityOption | null>(null);
  const [requestId] = React.useState(() => `m-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`);
  const set = <K extends keyof FormValues>(k: K, val: FormValues[K]) => setV((cur) => ({ ...cur, [k]: val }));

  const payload = React.useMemo(() => (v.endMin > v.startMin && /^\d{4}-\d{2}-\d{2}$/.test(v.dateKey) ? toPayload(v) : null), [v]);
  const conflicts = React.useMemo(
    () => (payload ? findConflicts(meetings, new Date(payload.startsAt), payload.endsAt, edit?.id) : []),
    [meetings, payload, edit?.id],
  );

  const finish = (r: ActionResult<MeetingResult>, okMsg: string) => {
    if (!r.ok) {
      setServerErrors(r.errors);
      return;
    }
    toast.success(okMsg);
    if (r.data.conflicts.length) toast.warning("Este horário conflita com outra reunião agendada.");
    if (r.data.warning) toast.warning(r.data.warning);
    onClose();
    router.refresh();
  };

  const onSave = (e: React.FormEvent) => {
    e.preventDefault();
    setServerErrors(undefined);
    const errs = validate(v, edit ? "edit" : "create");
    setErrors(errs);
    if (Object.keys(errs).length || !payload) return;
    startTransition(async () => {
      if (edit) {
        finish(await updateMeeting({ id: edit.id, startsAt: payload.startsAt, durationMin: payload.durationMin, timezone: v.timezone, link: v.link.trim(), notes: v.notes.trim() }), "Reunião atualizada.");
      } else {
        finish(
          await createMeeting({ opportunityId: v.opportunityId, startsAt: payload.startsAt, durationMin: payload.durationMin, timezone: v.timezone, link: v.link.trim(), notes: v.notes.trim(), clientRequestId: requestId }),
          "Reunião agendada.",
        );
      }
    });
  };
  const transition = (fn: typeof cancelMeeting, msg: string) => {
    if (!edit) return;
    setServerErrors(undefined);
    startTransition(async () => finish(await fn({ id: edit.id }), msg));
  };

  const startOpts = timeOptions(0, 24 * 60 - 15, v.startMin);
  const endOpts = timeOptions(v.startMin + 15, 24 * 60, v.endMin);
  const tzOpts = TIMEZONE_OPTIONS.some((o) => o.value === v.timezone) ? TIMEZONE_OPTIONS : [...TIMEZONE_OPTIONS, { value: v.timezone, label: v.timezone }];
  const formError = serverErrors ? getFormError(serverErrors) : undefined;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{edit ? "Reunião" : "Nova reunião"}</DialogTitle>
        <DialogDescription>
          {edit ? `${edit.leadName}${edit.company ? ` · ${edit.company}` : ""} · ${edit.campaignName}` : "Agende uma reunião com um lead. A oportunidade avança para Reunião Agendada."}
        </DialogDescription>
      </DialogHeader>

      {edit ? (
        <p className="text-xs text-muted-foreground">
          Status: <span className="font-medium text-foreground">{MEETING_STATUS_LABELS[edit.status] ?? edit.status}</span>
        </p>
      ) : null}

      <form onSubmit={onSave} className="grid gap-4" noValidate aria-busy={pending}>
        {!edit ? <LeadPicker picked={picked} error={errors.opportunityId ?? fieldError(serverErrors, "opportunityId")} onPick={(o) => { setPicked(o); set("opportunityId", o?.opportunityId ?? ""); }} /> : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="mt-date" label="Data" error={errors.dateKey ?? fieldError(serverErrors, "startsAt")}>
            <Input id="mt-date" type="date" value={v.dateKey} disabled={!editable} onChange={(e) => set("dateKey", e.target.value)} aria-invalid={!!errors.dateKey} aria-describedby={errors.dateKey ? "mt-date-error" : undefined} />
          </Field>
          <Field id="mt-start" label="Início">
            <select
              id="mt-start"
              className={nativeCls}
              disabled={!editable}
              value={v.startMin}
              onChange={(e) => {
                const s = Number(e.target.value);
                setV((cur) => ({ ...cur, startMin: s, endMin: Math.min(1440, s + (cur.endMin - cur.startMin)) }));
              }}
            >
              {startOpts.map((m) => (
                <option key={m} value={m}>{timeLabel(m)}</option>
              ))}
            </select>
          </Field>
          <Field id="mt-end" label="Fim" error={errors.endMin ?? fieldError(serverErrors, "durationMin")}>
            <select id="mt-end" className={nativeCls} disabled={!editable} value={v.endMin} onChange={(e) => set("endMin", Number(e.target.value))} aria-invalid={!!errors.endMin} aria-describedby={errors.endMin ? "mt-end-error" : undefined}>
              {endOpts.map((m) => (
                <option key={m} value={m}>{timeLabel(m)}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field id="mt-tz" label="Fuso horário">
          <select id="mt-tz" className={nativeCls} disabled={!editable} value={v.timezone} onChange={(e) => set("timezone", e.target.value)}>
            {tzOpts.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>

        <div aria-live="polite">
          {conflicts.length > 0 && editable ? (
            <div role="status" data-testid="conflict-warning" className="flex gap-2 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
              <div>
                <p className="font-medium">Conflito de horário</p>
                <p className="text-muted-foreground">
                  {conflicts.length === 1 ? "Já existe uma reunião" : `Já existem ${conflicts.length} reuniões`} neste horário ({conflicts.map((c) => `${formatDayShort(v.dateKey)}, ${formatTime(c.startsAt, v.timezone)}–${formatTime(c.endsAt, v.timezone)}`).join("; ")}). Você ainda pode salvar.
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <Field id="mt-link" label="Link da reunião (opcional)" error={errors.link ?? fieldError(serverErrors, "link")}>
          <Input id="mt-link" type="url" inputMode="url" placeholder="https://meet.google.com/..." value={v.link} disabled={!editable} onChange={(e) => set("link", e.target.value)} aria-invalid={!!(errors.link || fieldError(serverErrors, "link"))} aria-describedby={errors.link ? "mt-link-error" : undefined} />
        </Field>
        <Field id="mt-notes" label="Observações (opcional)" error={errors.notes ?? fieldError(serverErrors, "notes")}>
          <textarea id="mt-notes" className={textareaCls} maxLength={2000} value={v.notes} disabled={!editable} onChange={(e) => set("notes", e.target.value)} />
        </Field>

        {formError ? (
          <p role="alert" className="text-sm text-destructive">{formError}</p>
        ) : null}

        {confirmCancel && edit ? (
          <div role="alertdialog" aria-labelledby="mt-cancel-title" className="space-y-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm">
            <p id="mt-cancel-title" className="font-medium">Cancelar esta reunião?</p>
            <p className="text-muted-foreground">Atenção: cancelar não devolve a oportunidade para a etapa anterior. Ajuste o estágio no Pipeline, se necessário.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="destructive" size="sm" disabled={pending} onClick={() => transition(cancelMeeting, "Reunião cancelada.")}>Confirmar cancelamento</Button>
              <Button variant="outline" size="sm" disabled={pending} onClick={() => setConfirmCancel(false)}>Voltar</Button>
            </div>
          </div>
        ) : null}

        <DialogFooter className="sm:flex-wrap">
          {edit && editable ? (
            <div className="flex flex-wrap gap-2 sm:mr-auto">
              <Button variant="outline" size="sm" disabled={pending} onClick={() => transition(markMeetingDone, "Reunião marcada como realizada.")}>
                <CheckCircle2 aria-hidden="true" />
                Marcar realizada
              </Button>
              <Button variant="outline" size="sm" disabled={pending} onClick={() => transition(markMeetingNoShow, "Reunião marcada como no-show.")}>
                <UserX aria-hidden="true" />
                No-show
              </Button>
              <Button variant="ghost" size="sm" className="text-destructive" disabled={pending} onClick={() => setConfirmCancel(true)}>Cancelar reunião</Button>
            </div>
          ) : null}
          {edit?.link ? (
            <a href={edit.link} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/40 outline-none">
              <ExternalLink aria-hidden="true" className="size-4" />
              Abrir link
            </a>
          ) : null}
          <Button variant="outline" onClick={onClose} disabled={pending}>Fechar</Button>
          {editable ? (
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? "Salvando..." : "Salvar"}
            </Button>
          ) : null}
        </DialogFooter>
      </form>
    </>
  );
}

function LeadPicker({ picked, error, onPick }: { picked: LeadOpportunityOption | null; error?: string; onPick: (o: LeadOpportunityOption | null) => void }) {
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<LeadOpportunityOption[]>([]);
  const [status, setStatus] = React.useState<"idle" | "loading" | "error">("idle");
  const searching = !picked && q.trim().length >= 2;
  React.useEffect(() => {
    if (!searching) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setStatus("loading");
      const r = await searchMeetingLeads(q.trim()).catch(() => null);
      if (cancelled) return;
      if (r?.ok) {
        setResults(r.data);
        setStatus("idle");
      } else setStatus("error");
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, searching]);
  const shown = searching ? results : [];

  if (picked) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium">Lead</p>
        <div className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm">
          <span className="min-w-0 truncate">
            <span className="font-medium">{picked.leadName}</span>
            {picked.company ? <span className="text-muted-foreground"> · {picked.company}</span> : null}
            <span className="text-muted-foreground"> · {picked.campaignName}</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => onPick(null)}>Trocar<span className="sr-only"> lead</span></Button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <label htmlFor="mt-lead" className="text-sm font-medium">Lead</label>
      <Input id="mt-lead" type="search" autoComplete="off" placeholder="Buscar por nome ou empresa" value={q} onChange={(e) => setQ(e.target.value)} aria-invalid={!!error} aria-describedby="mt-lead-help" />
      <div id="mt-lead-help" aria-live="polite" className="text-xs text-muted-foreground">
        {status === "loading" ? "Buscando..." : status === "error" ? "Não foi possível buscar leads." : searching && status === "idle" && results.length === 0 ? "Nenhum lead encontrado." : "Digite ao menos 2 letras."}
      </div>
      {shown.length > 0 ? (
        <ul aria-label="Resultados da busca" className="max-h-44 divide-y divide-border overflow-y-auto rounded-md border border-border">
          {shown.map((o) => (
            <li key={o.opportunityId}>
              <button type="button" onClick={() => onPick(o)} className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent outline-none">
                <span className="font-medium">{o.leadName}{o.company ? <span className="font-normal text-muted-foreground"> · {o.company}</span> : null}</span>
                <span className="text-xs text-muted-foreground">{o.campaignName} · {o.stage}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
