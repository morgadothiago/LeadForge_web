import Link from "next/link";
import { FileText, MessageCircle, Users, Workflow } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { CampaignListItem } from "@/lib/queries/campaigns";
import { CampaignActions } from "./CampaignActions";
import { CampaignStatusBadge } from "./CampaignStatusBadge";

export function CampaignCard({ campaign: c }: { campaign: CampaignListItem }) {
  return (
    <Card className="hover-lift flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1.5">
          <CampaignStatusBadge status={c.status} />
          <h2 className="truncate font-heading text-base font-semibold">
            <Link
              href={`/campanhas/${c.id}`}
              className="rounded-sm outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {c.name}
            </Link>
          </h2>
        </div>
        <CampaignActions campaign={{ id: c.id, name: c.name, status: c.status, leadCount: c.leadCount }} />
      </div>
      {c.description && <p className="line-clamp-2 text-sm text-muted-foreground">{c.description}</p>}
      <p className="text-sm">
        <span className="text-muted-foreground">ICP: </span>
        {c.icp.name} <span className="text-muted-foreground">· {c.icp.niche}</span>
      </p>
      <dl className="mt-auto grid grid-cols-2 gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Users className="size-3.5" aria-hidden="true" />
          <dt className="sr-only">Leads</dt>
          <dd>{c.leadCount} lead{c.leadCount === 1 ? "" : "s"}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <FileText className="size-3.5" aria-hidden="true" />
          <dt className="sr-only">Templates</dt>
          <dd>{c.templateCount} template{c.templateCount === 1 ? "" : "s"}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <Workflow className="size-3.5" aria-hidden="true" />
          <dt className="sr-only">Sequência</dt>
          <dd className="truncate">{c.sequence?.name ?? "Sem sequência"}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <MessageCircle className="size-3.5" aria-hidden="true" />
          <dt className="sr-only">WhatsApp</dt>
          <dd className="truncate">{c.whatsappInstance?.instanceName ?? "Sem WhatsApp"}</dd>
        </div>
      </dl>
    </Card>
  );
}
