import { Info, Lock, ShieldAlert } from "lucide-react";
import { IntegrationAuditList } from "@/components/settings/IntegrationAuditList";
import { IntegrationCards } from "@/components/settings/IntegrationCard";
import { LeadSourceCards, type LeadSourceFlags } from "@/components/settings/LeadSourceCards";
import { Card } from "@/components/ui/card";
import { ForbiddenError } from "@/lib/auth/require-admin";
import { getMetaAppSecret, getMetaWebhookVerifyToken, isGoogleAdsLeadsEnabled, isMetaLeadsEnabled } from "@/lib/lead-source/config";
import { listIntegrationAudit, listIntegrations } from "@/lib/queries/integration";
import { listLeadSourceBindings, listLeadSourceCampaigns } from "@/lib/queries/lead-source";

export const dynamic = "force-dynamic";

function parsePage(v: string | string[] | undefined): number {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isInteger(n) && n >= 1 && n <= 100000 ? n : 1;
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const flags: LeadSourceFlags = {
    googleAdsEnabled: isGoogleAdsLeadsEnabled(),
    metaEnabled: isMetaLeadsEnabled(),
    metaAppSecret: getMetaAppSecret() !== null,
    metaVerifyToken: getMetaWebhookVerifyToken() !== null,
    baseUrl: process.env.APP_BASE_URL?.trim() || null,
  };
  let data;
  try {
    const [summaries, audit, bindings, campaigns] = await Promise.all([
      listIntegrations(),
      listIntegrationAudit({ page: parsePage(p.page) }),
      listLeadSourceBindings(),
      listLeadSourceCampaigns(),
    ]);
    data = { summaries, audit, bindings, campaigns };
  } catch (e) {
    if (e instanceof ForbiddenError || (e instanceof Error && e.message.includes("Sem permissão"))) {
      return (
        <Card role="alert" className="flex flex-col items-center gap-2 p-10 text-center">
          <Lock className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-heading text-lg font-semibold">Você não tem permissão para gerenciar integrações</p>
          <p className="text-sm text-muted-foreground">Somente administradores acessam esta área. Peça a um administrador para configurar as chaves.</p>
        </Card>
      );
    }
    throw e; // segue para o error boundary (error.tsx)
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-heading text-lg font-semibold">Integrações</h2>
        <p className="text-sm text-muted-foreground">Chaves e endereços dos serviços externos. As chaves são cifradas no banco e nunca são exibidas de volta.</p>
      </div>

      <div className="space-y-3">
        <div role="note" className="flex gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="space-y-1.5">
            <p>
              <strong className="text-foreground">Não ficam no painel:</strong> <code>DATABASE_URL</code>, <code>ENCRYPTION_KEY</code>, <code>AUTH_SECRET</code>,{" "}
              <code>APP_BASE_URL</code> e <code>CRON_SECRET</code>. Eles são necessários antes de o banco e o login funcionarem (ou autenticam o próprio app), então ficam no
              ambiente/gerenciador de segredos do servidor.
            </p>
            <p>
              Valores salvos aqui têm prioridade sobre o <code>.env</code>; ao remover, volta-se ao <code>.env</code> (quando existir).
            </p>
          </div>
        </div>
        <div role="note" className="flex gap-2 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <p>
            A <code>ENCRYPTION_KEY</code> protege todos os segredos salvos (integrações, chaves de instância e senhas de e-mail). Trocá-la sem re-cifrar torna tudo ilegível: com o app
            parado, rode <code>npm run secrets:reencrypt</code> (veja o passo a passo em <code>docs/CONFIGURACAO_POS_PROJETO.md</code>, seção 2) e só então atualize a variável.
          </p>
        </div>
      </div>

      <IntegrationCards summaries={data.summaries} />

      <section aria-labelledby="leadsource-h" className="space-y-3">
        <div>
          <h3 id="leadsource-h" className="font-heading text-base font-semibold">Captação de leads (Google Ads / Meta)</h3>
          <p className="text-sm text-muted-foreground">
            Vínculo 1:1 entre cada conta de anúncios/Página e uma campanha (SPEC-041). O identificador que chega no webhook resolve a origem — nunca um segredo global.
          </p>
        </div>
        <LeadSourceCards bindings={data.bindings} campaigns={data.campaigns} flags={flags} />
      </section>

      <section aria-labelledby="audit-h" className="space-y-3">
        <div>
          <h3 id="audit-h" className="font-heading text-base font-semibold">Histórico de alterações</h3>
          <p className="text-sm text-muted-foreground">Quem mexeu em quê e quando. Os valores das chaves nunca são registrados.</p>
        </div>
        <IntegrationAuditList audit={data.audit} />
      </section>
    </div>
  );
}
