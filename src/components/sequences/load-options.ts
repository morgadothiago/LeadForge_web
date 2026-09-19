import { listCampaigns } from "@/lib/queries/campaigns";
import { listTemplates } from "@/lib/queries/sequences";
import type { TemplateOption } from "./types";

/** Todos os templates de todas as campanhas (o builder filtra pela campanha do 1º passo). */
export async function loadTemplateOptions(): Promise<TemplateOption[]> {
  const campaigns = await listCampaigns({});
  const lists = await Promise.all(campaigns.map((c) => listTemplates(c.id)));
  return campaigns.flatMap((c, i) =>
    lists[i].map((t) => ({
      id: t.id,
      name: t.name,
      campaignId: c.id,
      campaignName: c.name,
      channel: t.channel,
      subject: t.subject,
      body: t.body,
    })),
  );
}
