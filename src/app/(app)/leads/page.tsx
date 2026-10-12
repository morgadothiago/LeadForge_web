import { LeadFilters } from "@/components/leads/LeadFilters";
import { LeadFormDialog } from "@/components/leads/LeadFormDialog";
import { LeadsTable } from "@/components/leads/LeadsTable";
import { LEAD_FILTER_KEYS, type RawParams } from "@/components/leads/lead-format";
import { listCampaigns } from "@/lib/queries/campaigns";
import { listLeads } from "@/lib/queries/leads";
import { leadListParamsSchema } from "@/lib/schemas/lead";
import { redirectIfTrialExpired } from "@/lib/auth/require-page";
import { getPlanUsage } from "@/lib/queries/usage";
import { LimitNotice, limitNoticeId } from "@/components/billing/LimitNotice";
import { isAtLimit } from "@/components/billing/trial-ui";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<RawParams> }) {
  await redirectIfTrialExpired(); // SPEC-065 (D-065-13.3): trial expirado => redirect a /configuracoes/assinatura
  const raw = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const p = leadListParamsSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, one(v)])));
  const [result, campaigns, usage] = await Promise.all([listLeads(p), listCampaigns(), getPlanUsage().catch(() => null)]);
  const leadsFull = usage ? isAtLimit(usage.byMetric.leads) : false;
  const camps = campaigns.map((c) => ({ id: c.id, name: c.name }));
  const hasFilters = LEAD_FILTER_KEYS.some((k) => Boolean(one(raw[k])?.trim()));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <LeadFilters params={raw} campaigns={camps} />
        </div>
        <LeadFormDialog mode="create" campaigns={camps} createDisabled={leadsFull} createDescribedBy={limitNoticeId("leads")} />
      </div>
      <LimitNotice item={usage?.byMetric.leads} />
      <LeadsTable {...result} sort={p.sort} dir={p.dir} params={raw} hasFilters={hasFilters} />
    </div>
  );
}
