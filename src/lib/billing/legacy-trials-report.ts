import type { PrismaClient, SubscriptionStatus } from "@prisma/client";

/**
 * SPEC-062 (D-062-17, politica A; Q-062-2 segue aberta) — relatorio SOMENTE LEITURA dos trials legados. Nao ha `UPDATE`/`DELETE`/
 * `--apply`: nada e alterado em nenhum ambiente. Serve para o dono do produto decidir (honrar `trialEndsAt` e bloquear depois;
 * ou outra politica) antes de a regra de expiracao (`computeOrgStatus`) atingir dados reais.
 */
export type TrialState = "vigente" | "vencido" | "sem_data";

export interface LegacyTrialRow {
  orgId: string;
  orgName: string;
  orgCreatedAt: Date;
  trialEndsAt: Date | null;
  state: TrialState;
  /** E-mail do dono mascarado (a***@dominio). */
  ownerEmail: string | null;
}

export interface LegacyTrialsReport {
  generatedAt: Date;
  /** Contagem por `Subscription.status` (a mesma consulta sugerida na SPEC-062). */
  byStatus: Array<{ status: SubscriptionStatus; count: number; oldestOrgCreatedAt: Date | null }>;
  trialing: LegacyTrialRow[];
  totals: { trialing: number; vigente: number; vencido: number; sem_data: number };
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

export function trialState(trialEndsAt: Date | null, now: Date): TrialState {
  if (!trialEndsAt) return "sem_data";
  return trialEndsAt.getTime() > now.getTime() ? "vigente" : "vencido";
}

/** Apenas `findMany`/`groupBy` (leitura). `db` e injetavel para testes. */
export async function buildLegacyTrialsReport(db: Pick<PrismaClient, "subscription">, now: Date): Promise<LegacyTrialsReport> {
  const subs = await db.subscription.findMany({
    select: {
      status: true,
      trialEndsAt: true,
      org: { select: { id: true, name: true, createdAt: true, memberships: { where: { orgRole: "owner" }, orderBy: { createdAt: "asc" }, take: 1, select: { user: { select: { email: true } } } } } },
    },
  });
  const groups = new Map<SubscriptionStatus, { count: number; oldest: Date | null }>();
  const trialing: LegacyTrialRow[] = [];
  for (const s of subs) {
    const g = groups.get(s.status) ?? { count: 0, oldest: null };
    g.count++;
    if (!g.oldest || s.org.createdAt < g.oldest) g.oldest = s.org.createdAt;
    groups.set(s.status, g);
    if (s.status !== "trialing") continue;
    const owner = s.org.memberships[0]?.user.email ?? null;
    trialing.push({
      orgId: s.org.id,
      orgName: s.org.name,
      orgCreatedAt: s.org.createdAt,
      trialEndsAt: s.trialEndsAt,
      state: trialState(s.trialEndsAt, now),
      ownerEmail: owner ? maskEmail(owner) : null,
    });
  }
  trialing.sort((a, b) => (a.trialEndsAt?.getTime() ?? 0) - (b.trialEndsAt?.getTime() ?? 0));
  const count = (st: TrialState) => trialing.filter((t) => t.state === st).length;
  return {
    generatedAt: now,
    byStatus: [...groups.entries()].map(([status, g]) => ({ status, count: g.count, oldestOrgCreatedAt: g.oldest })).sort((a, b) => a.status.localeCompare(b.status)),
    trialing,
    totals: { trialing: trialing.length, vigente: count("vigente"), vencido: count("vencido"), sem_data: count("sem_data") },
  };
}
