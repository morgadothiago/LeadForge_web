import Link from "next/link";
import { Search } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ORG_STATUS_LABELS, type RawParams } from "./org-format";

const selectCls =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20";
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Form GET nativo (funciona sem JS) — mesmo padrão de `LeadFilters`. Busca por nome/slug e filtro por status; reseta a página. */
export function OrganizationsSearchForm({ params }: { params: RawParams }) {
  const lbl = "mb-1 block text-xs font-medium text-muted-foreground";
  return (
    <form method="get" action="/admin/organizacoes" role="search" aria-label="Buscar organizações" className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
      <div>
        <label htmlFor="org-q" className={lbl}>
          Busca
        </label>
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input id="org-q" name="q" type="search" defaultValue={one(params.q)} maxLength={100} placeholder="Nome ou identificador da organização" className="pl-8" />
        </div>
      </div>
      <div>
        <label htmlFor="org-status" className={lbl}>
          Status
        </label>
        <select id="org-status" name="status" defaultValue={one(params.status)} className={selectCls}>
          <option value="">Todos</option>
          {Object.entries(ORG_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end gap-2">
        <Button type="submit">Filtrar</Button>
        <Link href="/admin/organizacoes" className={buttonVariants({ variant: "outline" })}>
          Limpar
        </Link>
      </div>
    </form>
  );
}
