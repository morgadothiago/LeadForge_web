import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { ChannelBadge } from "@/components/domain/ChannelBadge";
import type { ChannelKey } from "@/lib/domain";
import type { LeadDetail } from "@/lib/queries/leads";
import { formatDateTime, relativeTime } from "./lead-format";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  scheduled: "Agendado",
  sent: "Enviado",
  delivered: "Entregue",
  failed: "Falhou",
  skipped: "Ignorado",
  replied: "Respondido",
};

export function LeadTimeline({ touches }: { touches: LeadDetail["touches"] }) {
  if (touches.length === 0) return <p className="text-sm text-muted-foreground">Nenhum contato registrado ainda.</p>;
  return (
    <ol className="space-y-3">
      {touches.map((t) => {
        const when = t.sentAt ?? t.scheduledAt ?? t.createdAt;
        const out = t.direction === "outbound";
        const Icon = out ? ArrowUpRight : ArrowDownLeft;
        return (
          <li key={t.id} className="flex gap-3">
            <span
              className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${out ? "bg-primary/10 text-primary" : "bg-emerald-500/10 text-emerald-500"}`}
            >
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">{out ? "Enviado" : "Recebido"}</span>
                <ChannelBadge channel={t.channel as ChannelKey} />
                <span className={t.status === "failed" ? "text-destructive" : "text-muted-foreground"}>{STATUS_LABELS[t.status] ?? t.status}</span>
                <time dateTime={when.toISOString()} title={formatDateTime(when)} className="text-muted-foreground">
                  {relativeTime(when)} · {formatDateTime(when)}
                </time>
              </div>
              {t.content && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{t.content}</p>}
              {t.error && <p className="text-xs text-destructive">Erro: {t.error}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
