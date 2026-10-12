import { CampaignForm } from "@/components/campaigns/CampaignForm";
import { listWhatsAppInstances } from "@/lib/queries/whatsapp";
import { listCampaignFormOptions, listIcps } from "@/lib/queries/campaigns";
import { redirectIfTrialExpired } from "@/lib/auth/require-page";
import { getPlanUsage } from "@/lib/queries/usage";
import { LimitNotice } from "@/components/billing/LimitNotice";
import { isAtLimit } from "@/components/billing/trial-ui";

export const dynamic = "force-dynamic";

export default async function Page() {
  await redirectIfTrialExpired(); // SPEC-065 (D-065-13.3): trial expirado => redirect a /configuracoes/assinatura
  const [waInstances, icps, { sequences }, usage] = await Promise.all([listWhatsAppInstances(), listIcps(), listCampaignFormOptions(), getPlanUsage().catch(() => null)]);
  return (
    <div className="space-y-4">
      {/* No limite de campanhas ativas ainda da para criar PAUSADA/rascunho; so ativar e barrado (backend). */}
      <LimitNotice item={usage?.byMetric.campaigns} soft hint="Você ainda pode salvar a campanha como pausada, mas para ativá-la é preciso pausar outra ou fazer upgrade." />
    <CampaignForm
      defaultStatus={usage && isAtLimit(usage.byMetric.campaigns) ? "paused" : "active"}
      mode="create"
      icps={icps.map(({ id, name, niche }) => ({ id, name, niche }))}
      sequences={sequences}
      whatsappInstances={waInstances.map(({ id, instanceName, status }) => ({ id, instanceName, status }))}
    />
    </div>
  );
}
