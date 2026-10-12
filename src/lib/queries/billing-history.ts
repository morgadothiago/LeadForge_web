import { prisma } from "@/lib/prisma";
import { requireProviderOrgAllowExpired, ForbiddenError } from "@/lib/auth/require-admin";
import { loadBillingHistory, type BillingHistoryFilter, type BillingHistoryPage } from "@/lib/billing/billing-history-core";

/**
 * SPEC-066a — leitura autenticada do historico de mensalidades da organizacao da SESSAO (owner E member, Q-066-2). A logica
 * (cursor, filtros, resumo, derivacoes) mora em `@/lib/billing/billing-history-core` (nucleo puro, relogio injetado).
 */
export type { BillingChargeDto, BillingChargeViewStatus, BillingHistoryFilter, BillingHistoryPage, BillingHistorySummary } from "@/lib/billing/billing-history-core";

/** Leitura autenticada: a org vem SEMPRE da sessao (nunca do cliente). Owner e member leem; quem nao pertence a org e recusado. */
export async function getBillingHistory(params: { cursor?: string | null; filter?: BillingHistoryFilter } = {}, now: Date = new Date()): Promise<BillingHistoryPage> {
  const { user, orgId } = await requireProviderOrgAllowExpired(); // allowlist: a tela de assinatura abre com o trial expirado
  const membership = await prisma.membership.findUnique({ where: { userId_orgId: { userId: user.id, orgId } }, select: { orgRole: true } });
  if (!membership) throw new ForbiddenError();
  return loadBillingHistory({ orgId, cursor: params.cursor ?? null, filter: params.filter, now, isOwner: membership.orgRole === "owner" });
}
