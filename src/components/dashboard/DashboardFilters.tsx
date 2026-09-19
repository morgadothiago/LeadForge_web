import Link from "next/link";
import { cn } from "@/lib/utils";
import type { DashboardParams } from "@/lib/queries/dashboard";

function href(period: string, campaignId?: string) {
  const q = new URLSearchParams({ period });
  if (campaignId) q.set("campaignId", campaignId);
  return `/?${q.toString()}`;
}

export function DashboardFilters({
  params,
  campaigns,
}: {
  params: DashboardParams;
  campaigns: { id: string; name: string }[];
}) {
  const periods = [
    { v: "7d", l: "7 dias" },
    { v: "30d", l: "30 dias" },
  ] as const;
  const chip = (active: boolean) =>
    cn(
      "inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm transition-colors",
      active ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-muted-foreground hover:bg-accent",
    );
  return (
    <nav aria-label="Filtros do dashboard" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Período</span>
        {periods.map((p) => (
          <Link key={p.v} href={href(p.v, params.campaignId)} aria-current={params.period === p.v ? "true" : undefined} className={chip(params.period === p.v)}>
            {p.l}
          </Link>
        ))}
      </div>
      {campaigns.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Campanha</span>
          <Link href={href(params.period)} aria-current={!params.campaignId ? "true" : undefined} className={chip(!params.campaignId)}>
            Todas
          </Link>
          {campaigns.map((c) => (
            <Link key={c.id} href={href(params.period, c.id)} aria-current={params.campaignId === c.id ? "true" : undefined} className={cn(chip(params.campaignId === c.id), "max-w-full truncate")}>
              {c.name}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
