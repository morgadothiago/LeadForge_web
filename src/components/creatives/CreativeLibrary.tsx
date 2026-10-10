"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clapperboard, Loader2, Plus, Search, TriangleAlert } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { listCreatives } from "@/lib/actions/creative";
import { getFormError } from "@/components/campaigns/form-utils";
import type { AvatarsAndVoices, CreativeView, ListCreativesResult } from "@/lib/creatives/types";
import { CreativeCard } from "./CreativeCard";
import { MockProviderNotice } from "./MockProviderNotice";
import { STATUS_LABEL, filtersToQuery, isMockProvider, quotaSummary, type LibraryFilters } from "./creative-format";

const PAGE_SIZE = 20;

/**
 * SPEC-051b — biblioteca de criativos. Filtros/busca vivem na URL (`?status=&q=`, SSR); a primeira página vem do
 * servidor e "Carregar mais" pagina por cursor via `listCreatives`. Estados: vazio (sem filtro / com filtro), erro e carregando.
 */
export function CreativeLibrary({
  initial,
  filters,
  info,
  loadError,
}: {
  initial: ListCreativesResult | null;
  filters: LibraryFilters;
  info: AvatarsAndVoices | null;
  loadError?: string;
}) {
  const router = useRouter();
  // "Carregar mais" acumula em `more`, atrelado à 1a página (`src`): nova página do servidor (filtro/refresh) descarta o acumulado.
  const [more, setMore] = React.useState<{ src: ListCreativesResult | null; items: CreativeView[]; cursor: string | null; error?: string } | null>(null);
  const ext = more && more.src === initial ? more : null;
  const items: CreativeView[] = [...(initial?.items ?? []), ...(ext?.items ?? [])];
  const cursor = ext ? ext.cursor : (initial?.nextCursor ?? null);
  const moreError = ext?.error;
  const [pending, startTransition] = React.useTransition();
  const [q, setQ] = React.useState(filters.q ?? "");

  const hasFilter = Boolean(filters.status || filters.q);
  const quota = info ? quotaSummary(info) : null;

  function apply(next: LibraryFilters) {
    router.push(`/criativos${filtersToQuery(next)}`);
  }
  function loadMore() {
    if (!cursor) return;
    const base = ext ?? { src: initial, items: [], cursor };
    startTransition(async () => {
      const res = await listCreatives({ ...filters, cursor, limit: PAGE_SIZE });
      if (!res.ok) return setMore({ ...base, error: getFormError(res.errors, "Não foi possível carregar mais criativos.") });
      const seen = new Set([...(initial?.items ?? []), ...base.items].map((p) => p.id));
      setMore({ src: initial, items: [...base.items, ...res.data.items.filter((n) => !seen.has(n.id))], cursor: res.data.nextCursor });
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-heading text-lg font-semibold">Criativos</h2>
          <p className="text-sm text-muted-foreground">Vídeos de avatar com IA para usar nas suas abordagens.</p>
          {quota && (
            <p className="mt-1 text-xs text-muted-foreground">
              Cota do mês: {info!.usage.usedThisMonth} de {info!.limits.maxPerMonthPerOrg} usados · {quota.monthRemaining} restantes
            </p>
          )}
        </div>
        <Link href="/criativos/novo" className={buttonVariants()}>
          <Plus aria-hidden="true" /> Novo criativo
        </Link>
      </div>

      {info && isMockProvider(info.provider) && <MockProviderNotice />}

      <form
        role="search"
        aria-label="Filtrar criativos"
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          apply({ ...filters, q: q.trim() || undefined });
        }}
      >
        <div className="relative flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label="Buscar por título ou roteiro" placeholder="Buscar por título ou roteiro" value={q} onChange={(e) => setQ(e.target.value)} maxLength={120} className="pl-9" />
        </div>
        <select
          aria-label="Filtrar por status"
          value={filters.status ?? ""}
          onChange={(e) => apply({ ...filters, status: (e.target.value || undefined) as LibraryFilters["status"] })}
          className="h-9 rounded-md border border-input bg-card px-3 text-sm outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20"
        >
          <option value="">Todos os status</option>
          {Object.entries(STATUS_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          Buscar
        </Button>
        {hasFilter && (
          <Button type="button" variant="ghost" onClick={() => { setQ(""); apply({}); }}>
            Limpar filtros
          </Button>
        )}
      </form>

      {loadError ? (
        <Card role="alert" className="flex flex-col items-center gap-2 p-10 text-center">
          <TriangleAlert aria-hidden="true" className="size-8 text-destructive" />
          <p className="font-heading text-lg font-semibold">Não foi possível carregar os criativos</p>
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <Button variant="outline" onClick={() => router.refresh()} className="mt-2">
            Tentar novamente
          </Button>
        </Card>
      ) : items.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <Clapperboard aria-hidden="true" className="size-8 text-muted-foreground" />
          <p className="font-heading text-lg font-semibold">{hasFilter ? "Nenhum criativo encontrado" : "Nenhum criativo ainda"}</p>
          <p className="text-sm text-muted-foreground">
            {hasFilter ? "Tente outros termos ou limpe os filtros." : "Crie seu primeiro vídeo de avatar com IA a partir de um roteiro."}
          </p>
          {!hasFilter && (
            <Link href="/criativos/novo" className={buttonVariants({ className: "mt-2" })}>
              <Plus aria-hidden="true" /> Novo criativo
            </Link>
          )}
        </Card>
      ) : (
        <>
          <ul aria-label="Lista de criativos" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((c) => (
              <li key={c.id}>
                <CreativeCard creative={c} />
              </li>
            ))}
          </ul>
          {moreError && (
            <p role="alert" className="text-center text-sm text-destructive">
              {moreError}
            </p>
          )}
          {cursor && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={loadMore} disabled={pending} aria-busy={pending}>
                {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
                {pending ? "Carregando..." : "Carregar mais"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
