import Link from "next/link";
import { Building2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/components/leads/lead-format";
import type { OrgListPage } from "@/lib/queries/admin/organizations";
import { cn } from "@/lib/utils";
import { OrgStatusBadge } from "./OrgStatusBadge";
import { buildOrgsQuery, type RawParams } from "./org-format";

function Counters({ activeCampaigns, totalLeads, connectedWhatsapp }: { activeCampaigns: number; totalLeads: number; connectedWhatsapp: number }) {
  return (
    <span className="text-xs text-muted-foreground">
      {activeCampaigns} campanha{activeCampaigns === 1 ? "" : "s"} ativa{activeCampaigns === 1 ? "" : "s"} · {totalLeads} lead{totalLeads === 1 ? "" : "s"} · {connectedWhatsapp} WhatsApp
      conectado{connectedWhatsapp === 1 ? "" : "s"}
    </span>
  );
}

export function OrganizationsList({ items, total, page, pageSize, totalPages, params }: OrgListPage & { params: RawParams }) {
  if (items.length === 0) {
    const hasFilters = Boolean(params.q) || Boolean(params.status);
    return (
      <Card className="flex flex-col items-center gap-2 p-10 text-center">
        <Building2 className="size-8 text-muted-foreground" aria-hidden="true" />
        <p className="font-heading text-lg font-semibold">{hasFilters ? "Nenhuma organização com esses filtros" : "Nenhuma organização ainda"}</p>
        {hasFilters && (
          <Link href="/admin/organizacoes" className={cn(buttonVariants({ variant: "outline" }), "mt-2")}>
            Limpar filtros
          </Link>
        )}
      </Card>
    );
  }
  const q = (o: Record<string, string | number | null>) => `/admin/organizacoes${buildOrgsQuery(params, o)}`;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="space-y-4">
      {/* Desktop: tabela */}
      <div className="hidden overflow-hidden rounded-lg border border-border md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Organizações ({total})</caption>
          <thead className="bg-muted">
            <tr className="border-b border-border">
              <th scope="col" className="h-10 px-3 text-left align-middle text-xs font-medium text-muted-foreground">
                Nome
              </th>
              <th scope="col" className="h-10 px-3 text-left align-middle text-xs font-medium text-muted-foreground">
                Status
              </th>
              <th scope="col" className="h-10 px-3 text-left align-middle text-xs font-medium text-muted-foreground">
                Dono
              </th>
              <th scope="col" className="h-10 px-3 text-left align-middle text-xs font-medium text-muted-foreground">
                Contadores
              </th>
              <th scope="col" className="h-10 px-3 text-left align-middle text-xs font-medium text-muted-foreground">
                Criada em
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((o) => (
              <tr key={o.id} className="relative border-b border-border transition-colors last:border-0 hover:bg-card">
                <td className="px-3 py-3 font-medium">
                  <Link href={`/admin/organizacoes/${o.id}`} className="rounded-sm outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-primary/40">
                    {o.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">{o.slug}</p>
                </td>
                <td className="px-3 py-3">
                  <OrgStatusBadge status={o.status} />
                </td>
                <td className="max-w-[14rem] truncate px-3 py-3 text-muted-foreground">
                  {o.ownerName ? (
                    <>
                      {o.ownerName}
                      <span className="block text-xs">{o.ownerEmail}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-3">
                  <Counters activeCampaigns={o.activeCampaigns} totalLeads={o.totalLeads} connectedWhatsapp={o.connectedWhatsapp} />
                </td>
                <td className="px-3 py-3 text-muted-foreground">
                  <time dateTime={o.createdAt.toISOString()}>{formatDate(o.createdAt)}</time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards */}
      <ul className="grid gap-3 md:hidden">
        {items.map((o) => (
          <li key={o.id} className="relative rounded-lg border border-border bg-card p-4 hover:bg-accent/40">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={`/admin/organizacoes/${o.id}`} className="truncate font-semibold outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-primary/40">
                  {o.name}
                </Link>
                <p className="truncate text-xs text-muted-foreground">{o.slug}</p>
              </div>
              <OrgStatusBadge status={o.status} />
            </div>
            <p className="mt-2 truncate text-xs text-muted-foreground">{o.ownerName ? `${o.ownerName} · ${o.ownerEmail}` : "Sem dono definido"}</p>
            <div className="mt-2">
              <Counters activeCampaigns={o.activeCampaigns} totalLeads={o.totalLeads} connectedWhatsapp={o.connectedWhatsapp} />
            </div>
            <time className="mt-1 block text-xs text-muted-foreground" dateTime={o.createdAt.toISOString()}>
              Criada em {formatDate(o.createdAt)}
            </time>
          </li>
        ))}
      </ul>

      <nav aria-label="Paginação" className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-muted-foreground" aria-live="polite">
          {from}–{to} de {total} organização{total === 1 ? "" : "s"}
        </p>
        <div className="flex items-center gap-2">
          {page > 1 ? (
            <Link href={q({ page: page - 1 })} rel="prev" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Anterior
            </Link>
          ) : (
            <span aria-disabled="true" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-50")}>
              Anterior
            </span>
          )}
          <span className="text-muted-foreground">
            Página {page} de {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={q({ page: page + 1 })} rel="next" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Próxima
            </Link>
          ) : (
            <span aria-disabled="true" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-50")}>
              Próxima
            </span>
          )}
        </div>
      </nav>
    </div>
  );
}
