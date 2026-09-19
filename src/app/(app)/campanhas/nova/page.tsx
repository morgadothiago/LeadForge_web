import { CampaignForm } from "@/components/campaigns/CampaignForm";
import { listCampaignFormOptions, listIcps } from "@/lib/queries/campaigns";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [icps, { sequences, whatsappInstances }] = await Promise.all([listIcps(), listCampaignFormOptions()]);
  return (
    <CampaignForm
      mode="create"
      icps={icps.map(({ id, name, niche }) => ({ id, name, niche }))}
      sequences={sequences}
      whatsappInstances={whatsappInstances}
    />
  );
}
