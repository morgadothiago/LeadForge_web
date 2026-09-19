import Link from "next/link";
import { ShieldOff } from "lucide-react";
import { SuppressionAddDialog } from "@/components/settings/SuppressionAddDialog";
import { SuppressionFilters } from "@/components/settings/SuppressionFilters";
import { SuppressionList } from "@/components/settings/SuppressionList";
import { buildSuppressionQuery, parseSuppressionParams } from "@/components/settings/suppression-format";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { listSuppressions } from "@/lib/queries/suppression";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = parseSuppressionParams(await searchParams);
  const result = await listSuppressions({ kind: p.kind, q: p.q, page: p.page, pageSize: 25 });
  const hasFilters = Boolean(p.kind || p.q);
  const href = (page: number) => `/configuracoes/supressao${buildSuppressionQuery(p, { page })}`;
  const disabled = cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-50");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="font-heading text-lg font-semibold">Lista de supressão</h2>
          <p className="text-sm text-muted-foreground">
            Contatos que não devem receber mensagens em nenhum canal ou campanha. Todo pedido para parar (resposta, link de descadastro ou manual) entra aqui automaticamente.
          </p>
        </div>
        <SuppressionAddDialog />
      </div>

      <SuppressionFilters kind={p.kind} q={p.q} />

      {result.items.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <ShieldOff className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-heading text-lg font-semibold">{hasFilters ? "Nenhum contato com esses filtros" : "Nenhum contato suprimido"}</p>
          <p className="text-sm text-muted-foreground">
            {hasFilters ? "Ajuste ou limpe os filtros." : "Quando alguém pedir para não ser contatado, ele aparecerá aqui."}
          </p>
          {hasFilters && (
            <Link href="/configuracoes/supressao" className={cn(buttonVariants({ variant: "outline" }), "mt-2")}>
              Limpar filtros
            </Link>
          )}
        </Card>
      ) : (
        <>
          <SuppressionList items={result.items} />
          <nav aria-label="Paginação" className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-muted-foreground" aria-live="polite">
              {result.total} contato{result.total === 1 ? "" : "s"} suprimido{result.total === 1 ? "" : "s"}
            </p>
            <div className="flex items-center gap-2">
              {result.page > 1 ? (
                <Link href={href(result.page - 1)} rel="prev" className={buttonVariants({ variant: "outline", size: "sm" })}>Anterior</Link>
              ) : (
                <span aria-disabled="true" className={disabled}>Anterior</span>
              )}
              <span className="text-muted-foreground">Página {result.page} de {result.pageCount}</span>
              {result.page < result.pageCount ? (
                <Link href={href(result.page + 1)} rel="next" className={buttonVariants({ variant: "outline", size: "sm" })}>Próxima</Link>
              ) : (
                <span aria-disabled="true" className={disabled}>Próxima</span>
              )}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
