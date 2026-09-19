import Link from "next/link";
import { Search } from "lucide-react";
import { PipelineBoard } from "@/components/pipeline/PipelineBoard";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listCampaigns } from "@/lib/queries/campaigns";
import { getPipelineBoard } from "@/lib/queries/pipeline";
import { boardParamsSchema } from "@/lib/schemas/pipeline";

export const dynamic = "force-dynamic";

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { campaignId, q } = boardParamsSchema.parse({ campaignId: first(sp.campaignId), q: first(sp.q) });
  const [columns, campaigns] = await Promise.all([getPipelineBoard({ campaignId, q }), listCampaigns({ includeArchived: true })]);
  const filtered = Boolean(campaignId || q);

  return (
    <div className="space-y-4">
      <form method="get" action="/pipeline" role="search" className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label htmlFor="pl-campaign" className="text-xs font-medium text-muted-foreground">
            Campanha
          </label>
          <select
            id="pl-campaign"
            name="campaignId"
            defaultValue={campaignId ?? ""}
            className="h-9 w-full min-w-48 rounded-md border border-input bg-card px-3 text-sm outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20"
          >
            <option value="">Todas as campanhas</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-48 flex-1 space-y-1 sm:max-w-xs">
          <label htmlFor="pl-q" className="text-xs font-medium text-muted-foreground">
            Buscar lead
          </label>
          <Input id="pl-q" name="q" type="search" defaultValue={q ?? ""} placeholder="Nome, empresa ou email" maxLength={100} />
        </div>
        <Button type="submit">
          <Search /> Filtrar
        </Button>
        {filtered && (
          <Link href="/pipeline" className={buttonVariants({ variant: "ghost" })}>
            Limpar
          </Link>
        )}
      </form>
      <PipelineBoard columns={columns} campaignId={campaignId} />
    </div>
  );
}
