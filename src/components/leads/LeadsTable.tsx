import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown, TriangleAlert, Users } from "lucide-react";
import { ChannelBadge } from "@/components/domain/ChannelBadge";
import { StatusBadge } from "@/components/domain/StatusBadge";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { InboundReply } from "./InboundReply";
import { SuppressedBadge } from "./SuppressedBadge";
import { SEQUENCE_STATUS_TEXT } from "@/components/sequences/sequence-start-format";
import type { ChannelKey } from "@/lib/domain";
import type { LeadListItem } from "@/lib/queries/leads";
import { cn } from "@/lib/utils";
import { ariaSort, buildLeadsQuery, formatDate, nextSort, pageRange, type RawParams, type SortKey } from "./lead-format";

interface Props {
  items: LeadListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  sort: SortKey;
  dir: "asc" | "desc";
  params: RawParams;
  hasFilters: boolean;
}

const COLS: { key: SortKey | null; label: string; cls?: string }[] = [
  { key: "name", label: "Nome" },
  { key: null, label: "Empresa" },
  { key: null, label: "Campanha" },
  { key: null, label: "Etapa" },
  { key: null, label: "Canal" },
  { key: null, label: "Sequência" },
  { key: "score", label: "Score" },
  { key: "createdAt", label: "Criado em" },
];

function PossibleOptOutBadge() {
  return (
    <p className="mt-1 flex items-center gap-1 text-xs font-medium text-warning">
      <TriangleAlert className="size-3.5" aria-hidden="true" /> Possível opt-out: revise antes de contatar
    </p>
  );
}

function ScoreChip({ score }: { score: number }) {
  return <span className="rounded-sm bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">{score}</span>;
}

export function LeadsTable({ items, total, page, pageSize, pageCount, sort, dir, params, hasFilters }: Props) {
  if (items.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-2 p-10 text-center">
        <Users className="size-8 text-muted-foreground" aria-hidden="true" />
        <p className="font-heading text-lg font-semibold">{hasFilters ? "Nenhum lead com esses filtros" : "Nenhum lead ainda"}</p>
        <p className="text-sm text-muted-foreground">
          {hasFilters ? "Ajuste ou limpe os filtros para ver mais resultados." : "Cadastre um lead manualmente com o botão “Novo lead”."}
        </p>
        {hasFilters && (
          <Link href="/leads" className={cn(buttonVariants({ variant: "outline" }), "mt-2")}>
            Limpar filtros
          </Link>
        )}
      </Card>
    );
  }
  const q = (o: Record<string, string | number | null>) => `/leads${buildLeadsQuery(params, o)}`;
  const { from, to } = pageRange(page, pageSize, total);
  const cur = { sort, dir };

  return (
    <div className="space-y-4">
      {/* Desktop: tabela */}
      <div className="hidden overflow-hidden rounded-lg border border-[#202226] md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Leads ({total})</caption>
          <thead className="bg-[#1a1d21]">
            <tr className="border-b border-[#202226]">
              {COLS.map((c) => (
                <th
                  key={c.label}
                  scope="col"
                  aria-sort={c.key ? ariaSort(cur, c.key) : undefined}
                  className="h-10 px-3 text-left align-middle text-xs font-medium text-muted-foreground"
                >
                  {c.key ? (
                    <Link
                      href={q({ ...nextSort(cur, c.key), page: 1 })}
                      className="inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      {c.label}
                      {sort === c.key ? dir === "asc" ? <ArrowUp className="size-3" aria-hidden="true" /> : <ArrowDown className="size-3" aria-hidden="true" /> : <ChevronsUpDown className="size-3 opacity-50" aria-hidden="true" />}
                    </Link>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((l) => (
              <tr key={l.id} className="relative border-b border-[#202226] transition-colors last:border-0 hover:bg-[#131619] focus-within:bg-[#131619]">
                <td className="px-3 py-3 font-medium">
                  {/* after:absolute inset-0 estende o link à linha inteira (link real acessível) */}
                  <Link href={`/leads/${l.id}`} className="rounded-sm outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-primary/40">
                    {l.name}
                  </Link>
                  <InboundReply at={l.lastInboundAt} text={l.lastInboundText} max={50} className="mt-1 max-w-[16rem] font-normal" />
                  {l.possibleOptOut && <PossibleOptOutBadge />}
                  {l.suppressed && <SuppressedBadge className="mt-1" />}
                </td>
                <td className="max-w-[12rem] truncate px-3 py-3 text-muted-foreground">{l.company ?? "—"}</td>
                <td className="max-w-[12rem] truncate px-3 py-3 text-muted-foreground">{l.campaign.name}</td>
                <td className="px-3 py-3">{l.opportunity ? <StatusBadge stage={l.opportunity.stage} /> : "—"}</td>
                <td className="px-3 py-3">{l.lastChannel ? <ChannelBadge channel={l.lastChannel as ChannelKey} /> : <span className="text-muted-foreground">—</span>}</td>
                <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{SEQUENCE_STATUS_TEXT[l.sequenceStatus]}</td>
                <td className="px-3 py-3"><ScoreChip score={l.score} /></td>
                <td className="px-3 py-3 text-muted-foreground">
                  <time dateTime={l.createdAt.toISOString()}>{formatDate(l.createdAt)}</time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards */}
      <ul className="grid gap-3 md:hidden">
        {items.map((l) => (
          <li key={l.id} className="relative rounded-lg border border-[#202226] bg-card p-4 hover:bg-[#131619]">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={`/leads/${l.id}`} className="truncate font-semibold outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-primary/40">
                  {l.name}
                </Link>
                {l.company && <p className="truncate text-xs text-muted-foreground">{l.company}</p>}
              </div>
              {l.opportunity && <StatusBadge stage={l.opportunity.stage} />}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {l.lastChannel && <ChannelBadge channel={l.lastChannel as ChannelKey} />}
              <ScoreChip score={l.score} />
              <span className="text-xs text-muted-foreground">Sequência: {SEQUENCE_STATUS_TEXT[l.sequenceStatus]}</span>
              <time className="text-xs text-muted-foreground" dateTime={l.createdAt.toISOString()}>{formatDate(l.createdAt)}</time>
            </div>
            <InboundReply at={l.lastInboundAt} text={l.lastInboundText} className="mt-2" />
            {l.possibleOptOut && <PossibleOptOutBadge />}
            {l.suppressed && <SuppressedBadge className="mt-1" />}
            <p className="mt-1 truncate text-xs text-muted-foreground">{l.campaign.name}</p>
          </li>
        ))}
      </ul>

      <nav aria-label="Paginação" className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-muted-foreground" aria-live="polite">
          {from}–{to} de {total} lead{total === 1 ? "" : "s"}
        </p>
        <div className="flex items-center gap-2">
          {page > 1 ? (
            <Link href={q({ page: page - 1 })} rel="prev" className={buttonVariants({ variant: "outline", size: "sm" })}>Anterior</Link>
          ) : (
            <span aria-disabled="true" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-50")}>Anterior</span>
          )}
          <span className="text-muted-foreground">Página {page} de {pageCount}</span>
          {page < pageCount ? (
            <Link href={q({ page: page + 1 })} rel="next" className={buttonVariants({ variant: "outline", size: "sm" })}>Próxima</Link>
          ) : (
            <span aria-disabled="true" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-50")}>Próxima</span>
          )}
        </div>
      </nav>
    </div>
  );
}
