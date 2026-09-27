import { prisma } from "@/lib/prisma";

/**
 * SPEC-034 — catálogo de planos para exibição (Configurações > Assinatura E `/signup`, público).
 * Fica em `src/lib/billing/` (não em `src/lib/queries/`, que é reservado a leituras AUTENTICADAS
 * escopadas por org — ver `queries chamam requireUser antes do prisma` em `src/lib/auth/auth.test.ts`):
 * `Plan` é catálogo GLOBAL da plataforma, sem `orgId` (como `PLAN_SEED`, `prisma/seed.ts`), então não
 * exige sessão — precisa ser legível por um visitante não autenticado em `/signup` antes de existir
 * sessão/org.
 */

export interface PlanLimits {
  maxCampaigns: number | null;
  maxWhatsappInstances: number | null;
  maxLeadsPerMonth: number | null;
}

export interface PlanView {
  key: string;
  name: string;
  priceMonthlyCents: number;
  priceYearlyCents: number | null;
  limits: PlanLimits;
  selfServiceCheckout: boolean;
}

function parseLimits(json: unknown): PlanLimits {
  const o = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  return { maxCampaigns: num(o.maxCampaigns), maxWhatsappInstances: num(o.maxWhatsappInstances), maxLeadsPerMonth: num(o.maxLeadsPerMonth) };
}

/** Planos ativos, do mais barato ao mais caro (D-33-2: preços/limites são PLACEHOLDER). */
export async function listActivePlans(): Promise<PlanView[]> {
  const rows = await prisma.plan.findMany({
    // SPEC-040 (D-040-2): plano "courtesy" (contas de cortesia criadas manualmente pelo platform_admin,
    // ver createCourtesyOrganization) nunca aparece na vitrine pública — não é atribuível por
    // self-service e não deve ser oferecido/visível na landing nem no `/signup`.
    where: { active: true, key: { not: "courtesy" } },
    orderBy: { priceMonthlyCents: "asc" },
    select: { key: true, name: true, priceMonthlyCents: true, priceYearlyCents: true, limits: true, selfServiceCheckout: true },
  });
  return rows.map((r) => ({ ...r, limits: parseLimits(r.limits) }));
}
