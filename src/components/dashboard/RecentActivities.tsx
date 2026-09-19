import { StatusBadge } from "@/components/domain/StatusBadge";
import { ChannelBadge } from "@/components/domain/ChannelBadge";
import type { DashboardActivity } from "@/lib/queries/dashboard";
import type { ChannelKey, StageKey } from "@/lib/domain";

const VERB: Record<DashboardActivity["kind"], string> = {
  touch_outbound: "Mensagem enviada para",
  touch_inbound: "Resposta recebida de",
  stage_change: "Estágio atualizado:",
};

const fmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function RecentActivities({ items }: { items: DashboardActivity[] }) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma atividade recente.</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {items.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
          <p className="min-w-0 flex-1 basis-56 text-sm">
            <span className="text-muted-foreground">{VERB[a.kind]} </span>
            <span className="font-medium">{a.leadName}</span>
          </p>
          <div className="flex items-center gap-2">
            {a.channel && <ChannelBadge channel={a.channel as ChannelKey} />}
            {a.stage && <StatusBadge stage={a.stage as StageKey} />}
            <time dateTime={a.at.toISOString()} className="text-xs text-muted-foreground">
              {fmt.format(a.at)}
            </time>
          </div>
        </li>
      ))}
    </ul>
  );
}
