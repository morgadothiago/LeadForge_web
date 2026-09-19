import Link from "next/link";
import { Search } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const selectCls =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20";
const lbl = "mb-1 block text-xs font-medium text-muted-foreground";

/** Form GET nativo (funciona sem JS); reseta a página. */
export function SuppressionFilters({ kind, q }: { kind?: "phone" | "email"; q?: string }) {
  return (
    <form method="get" action="/configuracoes/supressao" role="search" aria-label="Filtrar lista de supressão" className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
      <div>
        <label htmlFor="s-kind" className={lbl}>Tipo</label>
        <select id="s-kind" name="kind" defaultValue={kind ?? ""} className={selectCls}>
          <option value="">Todos</option>
          <option value="phone">Telefone</option>
          <option value="email">E-mail</option>
        </select>
      </div>
      <div>
        <label htmlFor="s-q" className={lbl}>Busca</label>
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input id="s-q" name="q" type="search" defaultValue={q ?? ""} maxLength={100} placeholder="Parte do e-mail ou telefone (E.164, ex.: +5511)" className="pl-8" />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit">Filtrar</Button>
        <Link href="/configuracoes/supressao" className={buttonVariants({ variant: "outline" })}>Limpar</Link>
      </div>
    </form>
  );
}
