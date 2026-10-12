import { prisma } from "@/lib/prisma";
import { requireProviderOrg } from "@/lib/auth/require-admin";
import { getOrgLimits, limitFor, type LimitMetric } from "@/lib/billing/limits";
import { currentUsage, dayKey, leadsPeriodKey } from "@/lib/billing/usage";
import { METRIC_LABELS, type UsageItem } from "@/components/billing/trial-ui";

/**
 * SPEC-065b (D-065-18, "UsageMeter") — uso x limite da organizacao da sessao, SO LEITURA: estoque (campanhas ativas, instancias, contas
 * de e-mail) por contagem de linhas e fluxo (leads, envios) pelo `UsageCounter` da 065a. Usa `requireProviderOrg` (fail-closed): org com
 * trial expirado nao le nada daqui (a tela de bloqueio nao mostra o medidor). `limit: null` = ilimitado (cortesia/admin/plano sem teto).
 */
export interface PlanUsage {
  planKey: string | null;
  trialing: boolean;
  items: UsageItem[];
  byMetric: Record<LimitMetric, UsageItem>;
}

export async function getPlanUsage(now: Date = new Date()): Promise<PlanUsage> {
  const { orgId } = await requireProviderOrg();
  const limits = await getOrgLimits(prisma, orgId);
  const [campaigns, whatsapp, emailAccounts, leads, sends] = await Promise.all([
    prisma.campaign.count({ where: { orgId, status: "active" } }),
    prisma.whatsAppInstance.count({ where: { orgId } }),
    prisma.emailAccount.count({ where: { orgId } }),
    currentUsage(prisma, orgId, "leads", leadsPeriodKey(limits, now)),
    currentUsage(prisma, orgId, "sends", dayKey(now)),
  ]);
  const used: Record<LimitMetric, number> = { campaigns, whatsapp, email_accounts: emailAccounts, leads, sends };
  const metrics: LimitMetric[] = ["campaigns", "whatsapp", "email_accounts", "leads", "sends"];
  const items = metrics.map((metric): UsageItem => {
    const meta = METRIC_LABELS[metric];
    // No Free a janela de leads e o proprio teste (D-065-17b); no plano pago, o mes.
    const scope = metric === "leads" ? (limits.trialing ? "durante o teste" : "neste mês") : meta.scope;
    return { metric, label: meta.label, scope, used: used[metric], limit: limitFor(limits, metric) };
  });
  const byMetric = Object.fromEntries(items.map((i) => [i.metric, i])) as Record<LimitMetric, UsageItem>;
  return { planKey: limits.planKey, trialing: limits.trialing, items, byMetric };
}
