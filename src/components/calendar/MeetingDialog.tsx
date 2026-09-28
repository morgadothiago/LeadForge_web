"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ExternalLink, UserX } from "lucide-react";
import { toast } from "sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type FieldPath } from "react-hook-form";
import { z } from "zod";
import { getFormError, rhfErrorAt } from "@/components/campaigns/form-utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cancelMeeting, createMeeting, markMeetingDone, markMeetingNoShow, updateMeeting, type MeetingResult } from "@/lib/actions/meeting";
import { searchMeetingLeads } from "@/lib/actions/meeting-search";
import type { FieldErrors } from "@/lib/actions/result";
import type { LeadOpportunityOption } from "@/lib/queries/meetings";
import { createMeetingSchema, updateMeetingSchema } from "@/lib/schemas/meeting";
import {
  MEETING_STATUS_LABELS, TIMEZONE_OPTIONS, initialValues, timeLabel, timeOptions, toPayload, valuesFromMeeting, type FormValues,
} from "@/lib/calendar/form";
import { findConflicts, formatDayShort, formatTime, instantAt } from "@/lib/calendar/tz";
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

/** `FormValues` (dateKey/startMin/endMin) → `startsAt` ISO do schema. Data impossível vira `""` e cai no refine (nunca `toISOString()` de NaN). */
function startsAtISO(v: FormValues): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.dateKey)) return "";
  const d = instantAt(v.dateKey, v.startMin, v.timezone);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
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
  const [pending, startTransition] = React.useTransition();
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const [picked, setPicked] = React.useState<LeadOpportunityOption | null>(null);
  const [requestId] = React.useState(() => `m-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`);

  // Mesmo build do `toPayload()` original (trim de link/notes, duração = fim - início); create injeta opportunityId/clientRequestId.
  const resolver = React.useMemo(() => {
    const base = (v: FormValues) => ({
      startsAt: startsAtISO(v),
      durationMin: v.endMin - v.startMin,
      timezone: v.timezone,
      link: v.link.trim(),
      notes: v.notes.trim(),
    });
    return edit
      ? zodResolver(z.preprocess((v: FormValues) => ({ ...base(v), id: edit.id }), updateMeetingSchema))
      : zodResolver(z.preprocess((v: FormValues) => ({ ...base(v), opportunityId: v.opportunityId, clientRequestId: requestId }), createMeetingSchema));
  }, [edit, requestId]);

  const { register, handleSubmit, watch, setValue, setError, clearErrors, setFocus, formState } = useForm<FormValues, unknown, z.output<typeof createMeetingSchema> | z.output<typeof updateMeetingSchema>>({
    resolver,
    defaultValues: edit ? valuesFromMeeting(edit) : initialValues(state.mode === "create" ? state.dateKey : ""),
  });
  const { errors } = formState;

  const dateKey = watch("dateKey");
  const startMin = watch("startMin");
  const endMin = watch("endMin");
  const timezone = watch("timezone");

  const payload = React.useMemo(
    () => (endMin > startMin && /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? toPayload({ dateKey, startMin, endMin, timezone, link: "", notes: "", opportunityId: "" }) : null),
    [dateKey, startMin, endMin, timezone],
  );
  const conflicts = React.useMemo(
    () => (payload ? findConflicts(meetings, new Date(payload.startsAt), payload.endsAt, edit?.id) : []),
    [meetings, payload, edit?.id],
  );

  /** Erros vindos do server (ActionResult). Mesmos caminhos do schema ("startsAt", "durationMin", "opportunityId", ...). */
  function applyServerErrors(errs: FieldErrors) {
    clearErrors();
    let first: FieldPath<FormValues> | undefined;
    for (const [key, msgs] of Object.entries(errs)) {
      if (key === "_form") continue;
      const path = key as FieldPath<FormValues>;
      first ??= path;
      setError(path, { type: "server", message: msgs.join(" ") });
    }
    if (errs._form) setError("root", { type: "server", message: errs._form.join(" ") });
    toast.error(getFormError(errs));
    // No-op seguro para caminhos não registrados (data/fim): o RHF só foca se houver ref.
    if (first) setFocus(first);
  }

  const finishOk = (r: MeetingResult, okMsg: string) => {
    toast.success(okMsg);
    if (r.conflicts.length) toast.warning("Este horário conflita com outra reunião agendada.");
    if (r.warning) toast.warning(r.warning);
    onClose();
    router.refresh();
  };

  const onSubmit = handleSubmit((values) => {
    clearErrors();
    startTransition(async () => {
      const startsAt = values.startsAt instanceof Date ? values.startsAt.toISOString() : "";
      const r = edit
        ? await updateMeeting({ id: edit.id, startsAt, durationMin: values.durationMin, timezone: values.timezone, link: values.link, notes: values.notes })
        : await createMeeting({
            opportunityId: (values as z.output<typeof createMeetingSchema>).opportunityId,
            startsAt,
            durationMin: values.durationMin,
            timezone: values.timezone,
            link: values.link,
            notes: values.notes,
            clientRequestId: (values as z.output<typeof createMeetingSchema>).clientRequestId,
          });
      if (!r.ok) {
        applyServerErrors(r.errors);
        return;
      }
      finishOk(r.data, edit ? "Reunião atualizada." : "Reunião agendada.");
    });
  });

  const transition = (fn: typeof cancelMeeting, msg: string) => {
    if (!edit) return;
    startTransition(async () => {
      const r = await fn({ id: edit.id });
      if (!r.ok) {
        // Só banner, sem toast (comportamento original das transições).
        setError("root", { type: "server", message: getFormError(r.errors) });
        return;
      }
      finishOk(r.data, msg);
    });
  };

  const startOpts = timeOptions(0, 24 * 60 - 15, startMin);
  const endOpts = timeOptions(startMin + 15, 24 * 60, endMin);
  const tzOpts = TIMEZONE_OPTIONS.some((o) => o.value === timezone) ? TIMEZONE_OPTIONS : [...TIMEZONE_OPTIONS, { value: timezone, label: timezone }];
  const dateErr = rhfErrorAt(errors, "startsAt");
  const durationErr = rhfErrorAt(errors, "durationMin");
  const formError = errors.root?.message;

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

      <form onSubmit={onSubmit} className="grid gap-4" noValidate aria-busy={pending}>
        {!edit ? <LeadPicker picked={picked} error={errors.opportunityId?.message} onPick={(o) => { setPicked(o); setValue("opportunityId", o?.opportunityId ?? ""); }} /> : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="mt-date" label="Data" error={dateErr}>
            <Input id="mt-date" type="date" {...register("dateKey")} disabled={!editable} aria-invalid={!!dateErr} aria-describedby={dateErr ? "mt-date-error" : undefined} />
          </Field>
          <Field id="mt-start" label="Início">
            <select
              id="mt-start"
              className={nativeCls}
              disabled={!editable}
              value={startMin}
              onChange={(e) => {
                const s = Number(e.target.value);
                setValue("startMin", s);
                setValue("endMin", Math.min(1440, s + (endMin - startMin)));
              }}
            >
              {startOpts.map((m) => (
                <option key={m} value={m}>{timeLabel(m)}</option>
              ))}
            </select>
          </Field>
          <Field id="mt-end" label="Fim" error={durationErr}>
            <select id="mt-end" className={nativeCls} disabled={!editable} value={endMin} onChange={(e) => setValue("endMin", Number(e.target.value))} aria-invalid={!!durationErr} aria-describedby={durationErr ? "mt-end-error" : undefined}>
              {endOpts.map((m) => (
                <option key={m} value={m}>{timeLabel(m)}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field id="mt-tz" label="Fuso horário">
          <select id="mt-tz" className={nativeCls} disabled={!editable} value={timezone} onChange={(e) => setValue("timezone", e.target.value)}>
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
                  {conflicts.length === 1 ? "Já existe uma reunião" : `Já existem ${conflicts.length} reuniões`} neste horário ({conflicts.map((c) => `${formatDayShort(dateKey)}, ${formatTime(c.startsAt, timezone)}–${formatTime(c.endsAt, timezone)}`).join("; ")}). Você ainda pode salvar.
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <Field id="mt-link" label="Link da reunião (opcional)" error={errors.link?.message}>
          <Input id="mt-link" type="url" inputMode="url" placeholder="https://meet.google.com/..." {...register("link")} disabled={!editable} aria-invalid={!!errors.link} aria-describedby={errors.link ? "mt-link-error" : undefined} />
        </Field>
        <Field id="mt-notes" label="Observações (opcional)" error={errors.notes?.message}>
          <textarea id="mt-notes" className={textareaCls} maxLength={2000} {...register("notes")} disabled={!editable} />
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
