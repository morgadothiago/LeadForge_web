import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseLimits } from "./plans";

/**
 * SPEC-065 (D-065-8/18) — fonte unica dos limites do plano (`Subscription.plan.limits`). `null` em uma chave = ILIMITADO; org sem
 * `Subscription` (admin/seed) e plano `courtesy` = ilimitado (D-065-25). Limites so barram NOVAS criacoes/ativacoes (downgrade nao retroage).
 */
export type Db = PrismaClient | Prisma.TransactionClient;

export type LimitMetric = "campaigns" | "whatsapp" | "email_accounts" | "leads" | "sends";

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

const UNLIMITED: OrgLimits = { maxCampaigns: null, maxWhatsappInstances: null, maxEmailAccounts: null, maxLeadsPerMonth: null, maxSendsPerDay: null, planKey: null, trialing: false };

export async function getOrgLimits(db: Db, orgId: string): Promise<OrgLimits> {
  const sub = await db.subscription.findUnique({ where: { orgId }, select: { status: true, plan: { select: { key: true, limits: true } } } });
  if (!sub) return UNLIMITED;
  if (sub.plan.key === "courtesy") return { ...UNLIMITED, planKey: "courtesy" };
  const l = parseLimits(sub.plan.limits);
  return { ...l, planKey: sub.plan.key, trialing: sub.status === "trialing" };
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

const MESSAGES: Record<LimitMetric, (n: number) => string> = {
  campaigns: (n) => `Seu plano permite ${n} campanha${n === 1 ? "" : "s"} ativa${n === 1 ? "" : "s"}. Pause ou arquive uma, ou faça upgrade.`,
  whatsapp: (n) => `Seu plano permite ${n} número${n === 1 ? "" : "s"} de WhatsApp. Remova um ou faça upgrade.`,
  email_accounts: (n) => `Seu plano permite ${n} conta${n === 1 ? "" : "s"} de e-mail. Remova uma ou faça upgrade.`,
  leads: (n) => `Seu plano atingiu o limite de ${n} lead${n === 1 ? "" : "s"}. Faça upgrade para continuar trazendo leads.`,
  sends: (n) => `Seu plano atingiu o limite de ${n} envio${n === 1 ? "" : "s"} por dia. Os envios continuam amanhã, ou faça upgrade.`,
};

/** Erro tipado `plan_limit` (D-065-18). `handleActionError` o converte em `errors._form` + `code:["plan_limit"]` + `metric/limit/used`. */
export class PlanLimitError extends Error {
  readonly code = "plan_limit" as const;
  constructor(
    readonly metric: LimitMetric,
    readonly limit: number,
    readonly used: number,
  ) {
    super(MESSAGES[metric](limit));
    this.name = "PlanLimitError";
  }
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
