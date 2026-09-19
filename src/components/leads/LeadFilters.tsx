import Link from "next/link";
import { Search } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CHANNELS, CHANNEL_LABELS, STAGES, STAGE_LABELS } from "@/lib/domain";
import type { RawParams } from "./lead-format";

const selectCls =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20";
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Form GET nativo (funciona sem JS). Preserva sort/dir/pageSize; reseta a página. */
export function LeadFilters({ params, campaigns }: { params: RawParams; campaigns: { id: string; name: string }[] }) {
  const lbl = "mb-1 block text-xs font-medium text-muted-foreground";
  return (
    <form method="get" action="/leads" role="search" aria-label="Filtrar leads" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      {(["sort", "dir", "pageSize"] as const).map((k) => (one(params[k]) ? <input key={k} type="hidden" name={k} value={one(params[k])} /> : null))}
      <div className="sm:col-span-2">
        <label htmlFor="f-q" className={lbl}>Busca</label>
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input id="f-q" name="q" type="search" defaultValue={one(params.q)} maxLength={100} placeholder="Nome, e-mail ou empresa" className="pl-8" />
        </div>
      </div>
      <div>
        <label htmlFor="f-camp" className={lbl}>Campanha</label>
        <select id="f-camp" name="campaignId" defaultValue={one(params.campaignId)} className={selectCls}>
          <option value="">Todas</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="f-stage" className={lbl}>Etapa</label>
        <select id="f-stage" name="stage" defaultValue={one(params.stage)} className={selectCls}>
          <option value="">Todas</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>{STAGE_LABELS[s]}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="f-ch" className={lbl}>Canal</label>
        <select id="f-ch" name="channel" defaultValue={one(params.channel)} className={selectCls}>
          <option value="">Todos</option>
          {CHANNELS.map((c) => (
            <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>
          ))}
        </select>
      </div>
      <fieldset className="grid grid-cols-2 gap-2">
        <legend className={lbl}>Faixa de score</legend>
        <Input name="scoreMin" type="number" min={0} inputMode="numeric" defaultValue={one(params.scoreMin)} placeholder="Mín" aria-label="Score mínimo" />
        <Input name="scoreMax" type="number" min={0} inputMode="numeric" defaultValue={one(params.scoreMax)} placeholder="Máx" aria-label="Score máximo" />
      </fieldset>
      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6 lg:justify-end">
        <Button type="submit">Filtrar</Button>
        <Link href="/leads" className={buttonVariants({ variant: "outline" })}>Limpar</Link>
      </div>
    </form>
  );
}
