import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEntitlements } from "./entitlements";
import { PlanLimitError, type Db, type LimitMetric } from "./limit-error";

export { PlanLimitError, type Db, type ExtraLimitMetric, type LimitMetric } from "./limit-error";

/**
 * SPEC-065 (D-065-8/18) — fonte unica dos limites do plano. SPEC-069b: agora derivada de `getEntitlements` (plano + override ativo +
 * bloqueio), para que override por org e estados de assinatura valham tambem nos limites legados. `null` em uma chave = ILIMITADO; org sem
 * `Subscription` (admin/seed) e `courtesy`/`business` ativos = ilimitado (D-065-25). Limites so barram NOVAS criacoes/ativacoes (downgrade nao retroage).
 */

export interface OrgLimits {
  maxCampaigns: number | null;
  maxWhatsappInstances: number | null;
  maxEmailAccounts: number | null;
  maxLeadsPerMonth: number | null;
  maxSendsPerDay: number | null;
  planKey: string | null;
  /** `Subscription.status = trialing` (define a janela de leads: "trial" fixa em vez do mes civil). */
  trialing: boolean;
}

export async function getOrgLimits(db: Db, orgId: string, now: Date = new Date()): Promise<OrgLimits> {
  const ent = await getEntitlements(db, orgId, now);
  const l = ent.limits;
  return {
    maxCampaigns: l.maxCampaigns,
    maxWhatsappInstances: l.maxWhatsappInstances,
    maxEmailAccounts: l.maxEmailAccounts,
    maxLeadsPerMonth: l.maxLeadsPerMonth,
    maxSendsPerDay: l.maxSendsPerDay,
    planKey: ent.planKey,
    trialing: ent.subscriptionStatus === "trialing",
  };
}

const LIMIT_KEY: Record<LimitMetric, keyof Omit<OrgLimits, "planKey" | "trialing">> = {
  campaigns: "maxCampaigns",
  whatsapp: "maxWhatsappInstances",
  email_accounts: "maxEmailAccounts",
  leads: "maxLeadsPerMonth",
  sends: "maxSendsPerDay",
};

export function limitFor(limits: OrgLimits, metric: LimitMetric): number | null {
  return limits[LIMIT_KEY[metric]];
}

/**
 * Limite de ESTOQUE (campanhas ativas, instancias, contas de e-mail): chamar DENTRO da transacao, apos `lockOrg`, com `current` = contagem
 * atual de linhas. Lanca `PlanLimitError` se criar/ativar mais `adding` ultrapassaria o limite.
 */
export async function assertWithinLimit(db: Db, orgId: string, metric: Exclude<LimitMetric, "leads" | "sends">, current: number, adding = 1): Promise<void> {
  const limit = limitFor(await getOrgLimits(db, orgId), metric);
  if (limit === null) return;
  if (current + adding > limit) throw new PlanLimitError(metric, limit, current);
}

/**
 * `maxCampaigns` (campanhas ATIVAS): chamar DENTRO da transacao, apos `lockOrg`, ANTES de criar/ativar/retomar/desarquivar uma campanha.
 * `excludeCampaignId` = campanha que esta sendo ativada (nao conta contra si mesma). Pausar/arquivar nunca passa por aqui.
 */
export async function assertCanActivateCampaign(tx: Prisma.TransactionClient, orgId: string, excludeCampaignId?: string): Promise<void> {
  const current = await tx.campaign.count({ where: { orgId, status: "active", ...(excludeCampaignId ? { id: { not: excludeCampaignId } } : {}) } });
  await assertWithinLimit(tx, orgId, "campaigns", current);
}

/**
 * Atualiza a campanha (status `active` incluso) sob lock da org + checagem de maxCampaigns (so conta se ela ainda nao estava ativa).
 * Compartilhado pela web (`updateCampaign`/`resumeCampaign`) e pelo app movel (`setCampaignStatus`).
 */
export async function activateCampaignWithinLimit(orgId: string, id: string, data: Prisma.CampaignUncheckedUpdateInput): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${orgId} FOR UPDATE`;
    const cur = await tx.campaign.findFirst({ where: { id, orgId }, select: { status: true } });
    if (!cur) throw new Prisma.PrismaClientKnownRequestError("Registro não encontrado.", { code: "P2025", clientVersion: "internal" });
    if (cur.status !== "active") await assertCanActivateCampaign(tx, orgId, id);
    await tx.campaign.update({ where: { id }, data });
  });
}
