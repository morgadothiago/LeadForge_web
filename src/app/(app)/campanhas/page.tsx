import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";
import { CampaignCard } from "@/components/campaigns/CampaignCard";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { CAMPAIGN_STATUS_LABELS } from "@/lib/domain";
import { listCampaigns } from "@/lib/queries/campaigns";
import { campaignStatusSchema } from "@/lib/schemas/campaign";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).status;
  const parsed = campaignStatusSchema.safeParse(Array.isArray(raw) ? raw[0] : raw);
  const status = parsed.success ? parsed.data : undefined;
  const campaigns = await listCampaigns({ status });

  const filters = [
    { href: "/campanhas", label: "Todas", active: !status },
    ...(Object.keys(CAMPAIGN_STATUS_LABELS) as (keyof typeof CAMPAIGN_STATUS_LABELS)[]).map((k) => ({
      href: `/campanhas?status=${k}`,
      label: CAMPAIGN_STATUS_LABELS[k],
      active: status === k,
    })),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filtrar por status" className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <Link
              key={f.href}
              href={f.href}
              aria-current={f.active ? "page" : undefined}
              className={cn(
                "inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                f.active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </Link>
          ))}
        </nav>
        <div className="flex gap-2">
          <Link href="/campanhas/icps" className={buttonVariants({ variant: "outline" })}>
            Gerenciar ICPs
          </Link>
          <Link href="/campanhas/nova" className={buttonVariants()}>
            <Plus /> Nova campanha
          </Link>
        </div>
      </div>

      {campaigns.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <Megaphone className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-heading text-lg font-semibold">
            {status ? "Nenhuma campanha com este status" : "Nenhuma campanha ainda"}
          </p>
          <p className="text-sm text-muted-foreground">Crie sua primeira campanha para começar a prospectar.</p>
          <Link href="/campanhas/nova" className={cn(buttonVariants(), "mt-2")}>
            <Plus /> Nova campanha
          </Link>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((c) => (
            <li key={c.id}>
              <CampaignCard campaign={c} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
