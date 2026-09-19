"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCircle2, ChevronDown, OctagonPause, Play, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/campaigns/ConfirmDialog";
import { getFormError } from "@/components/campaigns/form-utils";
import { formatDateTime } from "@/components/leads/lead-format";
import { dismissInstanceAlerts, resumeInstance } from "@/lib/actions/whatsapp-health";
import type { InstanceHealthView } from "@/lib/queries/whatsapp-health";
import { cn } from "@/lib/utils";
import { HEALTH_STATE_INFO, formatRate, limitExplanation, pausedText, usagePercent, usageText, warmupText } from "./health-format";

const ICONS = { ok: CheckCircle2, warn: TriangleAlert, off: OctagonPause } as const;

interface MetricProps {
  label: string;
  value: string;
  help: string;
}
function Metric({ label, value, help }: MetricProps) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-sm font-medium", value === "dados insuficientes" && "font-normal text-muted-foreground")}>{value}</dd>
      <dd className="text-xs text-muted-foreground">{help}</dd>
    </div>
  );
}

export function WhatsAppHealthPanel({ instanceName, health: h }: { instanceName: string; health: InstanceHealthView }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [confirm, setConfirm] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [open, setOpen] = React.useState(false);
  const uid = React.useId();
  const info = HEALTH_STATE_INFO[h.state];
  const Icon = ICONS[info.tone];
  const pct = usagePercent(h.sentToday, h.effectiveLimitToday);
  const unread = h.alerts.filter((a) => a.readAt === null);
  const m = h.metrics;

  function resume() {
    setError(undefined);
    startTransition(async () => {
      const r = await resumeInstance(h.instanceId);
      if (r.ok) {
        toast.success(r.data.resumed ? `${instanceName}: envios retomados com a rampa reduzida.` : `${instanceName} não estava pausada.`);
        setConfirm(false);
        router.refresh();
      } else {
        const msg = getFormError(r.errors);
        setError(msg);
        toast.error(msg);
      }
    });
  }

  function dismiss() {
    startTransition(async () => {
      const r = await dismissInstanceAlerts(h.instanceId);
      if (r.ok) {
        toast.success("Alertas dispensados.");
        router.refresh();
      } else toast.error(getFormError(r.errors));
    });
  }

  return (
    <section aria-labelledby={`${uid}-t`} className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={`${uid}-t`} className="text-sm font-semibold">
          Saúde do envio
        </h4>
        <Badge variant={info.tone === "ok" ? "default" : info.tone === "off" ? "destructive" : "muted"} className={cn(info.tone === "warn" && "bg-warning/15 text-warning")} title={info.description}>
          <Icon className="size-3.5" aria-hidden="true" />
          {info.label}
        </Badge>
      </div>

      {h.state === "paused" && (
        <div role="status" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-sm">
          <p className="break-words">{pausedText(h.pausedUntil, h.pausedReason, formatDateTime)}.</p>
          <p className="text-xs text-muted-foreground">Enquanto pausada, os toques ficam agendados e nada é enviado. A retomada automática ocorre ao fim do prazo, com rampa reduzida.</p>
          <Button size="sm" variant="outline" onClick={() => { setError(undefined); setConfirm(true); }} disabled={pending}>
            <Play /> Retomar envios
          </Button>
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
          <span className="font-medium">{warmupText(h.warmupDay)}</span>
          <span id={`${uid}-use`} className="text-muted-foreground">{usageText(h.sentToday, h.effectiveLimitToday)}</span>
        </div>
        <div
          role="progressbar"
          aria-labelledby={`${uid}-use`}
          aria-valuemin={0}
          aria-valuemax={Math.max(h.effectiveLimitToday, 1)}
          aria-valuenow={Math.min(h.sentToday, Math.max(h.effectiveLimitToday, 1))}
          aria-valuetext={usageText(h.sentToday, h.effectiveLimitToday)}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div className={cn("h-full rounded-full", pct >= 100 ? "bg-warning" : "bg-primary")} style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">{limitExplanation(h.effectiveLimitToday, h.dailyLimitCeiling)}</p>
      </div>

      {h.warnings.length > 0 && (
        <ul role="status" className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs">
          {h.warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}

      {unread.length > 0 && (
        <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs">
          <p className="flex items-center gap-1.5 font-medium">
            <Bell className="size-3.5 text-warning" aria-hidden="true" /> {unread.length} alerta{unread.length === 1 ? "" : "s"} não lido{unread.length === 1 ? "" : "s"}
          </p>
          <ul className="space-y-1">
            {unread.map((a) => (
              <li key={a.id} className="break-words">
                <time dateTime={a.createdAt.toISOString()} className="text-muted-foreground">{formatDateTime(a.createdAt)}</time>: {a.message}
              </li>
            ))}
          </ul>
          <Button size="sm" variant="outline" onClick={dismiss} disabled={pending}>
            Dispensar
          </Button>
        </div>
      )}

      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${uid}-metrics`}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
        {open ? "Ocultar métricas" : "Ver métricas"}
      </button>
      <div id={`${uid}-metrics`} hidden={!open}>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Taxa de entrega" value={formatRate(m.deliveryRate)} help={`Últimos 20 envios (amostra mínima 10; ${m.deliverySample} válidos). Abaixo de 80% pausa.`} />
          <Metric label="Falhas seguidas" value={String(m.consecutiveFailures)} help="Envios que falharam em sequência. 2 ou mais pausam." />
          <Metric label="Taxa de resposta" value={formatRate(m.replyRate)} help="Leads que responderam. Indicador de qualidade da abordagem." />
          <Metric label="Taxa de opt-out" value={formatRate(m.optOutRate)} help={`Pedidos de parar ou possíveis (amostra mínima 20 leads; ${m.optOutSample} na janela). Acima de 5% pausa.`} />
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">Janela: últimos 50 envios / 7 dias, desde a última retomada. {m.sends} envio{m.sends === 1 ? "" : "s"} na janela.</p>
      </div>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Retomar envios?"
        description="A rampa de aquecimento recua um degrau e a janela de métricas é zerada. Retomar sem resolver a causa da pausa aumenta o risco de banimento do número. Só continue se você já verificou o motivo."
        confirmLabel="Retomar envios"
        destructive
        pending={pending}
        error={error}
        onConfirm={resume}
      />
    </section>
  );
}
