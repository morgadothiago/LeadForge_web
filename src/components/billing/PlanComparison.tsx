import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { HIGHLIGHTED_PLAN_KEY, type PlanKey } from "@/lib/billing/plan-catalog";
import { planComparison, type ComparisonCell } from "@/lib/billing/plan-ui";

/**
 * SPEC-069d — comparativo de planos gerado do MESMO catalogo (`plan-catalog.ts`) que o servidor aplica. Usado em Configuracoes > Assinatura
 * e na landing. Desktop (md+): tabela com cabecalhos de linha/coluna. Mobile: um cartao por grupo, cada linha com "Plano: valor" (sem rolagem
 * horizontal). Nao depende so de cor/icone: toda celula tem texto ("Incluído", "Não inclui") legivel por leitor de tela.
 */
export function PlanComparison({ columns, currentKey, id = "comparativo", className }: { columns: readonly PlanKey[]; currentKey?: string | null; id?: string; className?: string }) {
  const cmp = planComparison(columns);
  return (
    <section id={id} aria-labelledby={`${id}-h`} className={cn("scroll-mt-20 space-y-3", className)}>
      <div>
        <h3 id={`${id}-h`} className="font-heading text-base font-semibold">
          Compare os planos
        </h3>
        <p className="text-sm text-muted-foreground">Tudo o que cada plano inclui. Os valores são os mesmos aplicados pelo sistema.</p>
      </div>

      {/* Desktop */}
      <div className="hidden overflow-hidden rounded-xl border border-border md:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Comparativo de funcionalidades e limites por plano</caption>
          <thead>
            <tr className="bg-muted/40">
              <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                Funcionalidade
              </th>
              {cmp.columns.map((c) => (
                <th key={c.key} scope="col" className={cn("px-4 py-3 text-left font-heading font-semibold", c.key === HIGHLIGHTED_PLAN_KEY && "text-primary")}>
                  {c.name}
                  {c.key === currentKey ? <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Seu plano</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          {cmp.groups.map((g) => (
            <tbody key={g.title} className="border-t border-border">
              <tr className="bg-muted/20">
                <th scope="colgroup" colSpan={cmp.columns.length + 1} className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.title}
                </th>
              </tr>
              {g.rows.map((r) => (
                <tr key={r.label} className="border-t border-border/60">
                  <th scope="row" className="px-4 py-2.5 text-left font-normal">
                    {r.label}
                  </th>
                  {r.cells.map((cell, i) => (
                    <td key={cmp.columns[i].key} className="px-4 py-2.5">
                      <Cell cell={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      {/* Mobile */}
      <div className="space-y-3 md:hidden">
        {cmp.groups.map((g) => (
          <div key={g.title} className="rounded-xl border border-border bg-card p-4">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</h4>
            <ul className="divide-y divide-border">
              {g.rows.map((r) => (
                <li key={r.label} className="space-y-1 py-2.5">
                  <p className="text-sm font-medium">{r.label}</p>
                  <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {r.cells.map((cell, i) => (
                      <div key={cmp.columns[i].key} className="flex items-center gap-1.5">
                        <dt className="text-muted-foreground">{cmp.columns[i].name}:</dt>
                        <dd>
                          <Cell cell={cell} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function Cell({ cell }: { cell: ComparisonCell }) {
  if (cell.kind === "yes") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Check className="size-4 text-primary" aria-hidden="true" />
        <span>{cell.text}</span>
      </span>
    );
  }
  if (cell.kind === "no") {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Minus className="size-4" aria-hidden="true" />
        <span>{cell.text}</span>
      </span>
    );
  }
  return <span className="tabular-nums">{cell.text}</span>;
}
