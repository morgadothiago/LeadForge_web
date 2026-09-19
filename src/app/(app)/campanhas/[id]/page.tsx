import { notFound } from "next/navigation";
import { CampaignActions } from "@/components/campaigns/CampaignActions";
import { CampaignForm } from "@/components/campaigns/CampaignForm";
import { CampaignStatusBadge } from "@/components/campaigns/CampaignStatusBadge";
import { getCampaign, listCampaignFormOptions, listIcps } from "@/lib/queries/campaigns";
import { listWhatsAppInstances } from "@/lib/queries/whatsapp";
import { idSchema } from "@/lib/schemas/campaign";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const [waInstances, campaign, icps, { sequences }] = await Promise.all([
    listWhatsAppInstances(),
    getCampaign(id),
    listIcps(),
    listCampaignFormOptions(),
  ]);
  if (!campaign) notFound();

  return (
    <div className="space-y-6">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-heading text-xl font-semibold">{campaign.name}</h2>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <CampaignStatusBadge status={campaign.status} />
            {campaign.leadCount} lead{campaign.leadCount === 1 ? "" : "s"} · {campaign.templateCount} template
            {campaign.templateCount === 1 ? "" : "s"}
          </p>
        </div>
        <CampaignActions
          campaign={{ id: campaign.id, name: campaign.name, status: campaign.status, leadCount: campaign.leadCount }}
          afterDeleteHref="/campanhas"
        />
      </div>
      <CampaignForm
        key={campaign.updatedAt.toISOString()}
        mode="edit"
        campaign={{
          id: campaign.id,
          name: campaign.name,
          description: campaign.description,
          status: campaign.status,
          icpId: campaign.icp.id,
          sequenceId: campaign.sequence?.id ?? null,
          whatsappInstanceId: campaign.whatsappInstance?.id ?? null,
        }}
        icps={icps.map(({ id, name, niche }) => ({ id, name, niche }))}
        sequences={sequences}
        whatsappInstances={waInstances.map(({ id, instanceName, status }) => ({ id, instanceName, status }))}
      />
    </div>
  );
}
