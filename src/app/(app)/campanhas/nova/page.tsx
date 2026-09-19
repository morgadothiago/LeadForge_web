import { CampaignForm } from "@/components/campaigns/CampaignForm";
import { listWhatsAppInstances } from "@/lib/queries/whatsapp";
import { listCampaignFormOptions, listIcps } from "@/lib/queries/campaigns";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [waInstances, icps, { sequences }] = await Promise.all([listWhatsAppInstances(), listIcps(), listCampaignFormOptions()]);
  return (
    <CampaignForm
      mode="create"
      icps={icps.map(({ id, name, niche }) => ({ id, name, niche }))}
      sequences={sequences}
      whatsappInstances={waInstances.map(({ id, instanceName, status }) => ({ id, instanceName, status }))}
    />
  );
}
