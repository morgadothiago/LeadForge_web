import { prisma } from "@/lib/prisma";
import { FEATURE_KEYS, NEW_LIMIT_CATALOG, NEW_LIMIT_KEYS, type FeatureKey, type NewLimitKey } from "./plan-catalog";

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
  /** SPEC-065 (D-065-8): chaves novas, opcionais (ausente/null = ilimitado). */
  maxEmailAccounts?: number | null;
  maxSendsPerDay?: number | null;
  /** SPEC-069a (D-069-4): chaves novas, opcionais. `null` explicito = ilimitado; ausente = ver `NEW_LIMIT_CATALOG` (0 nas que custam dinheiro/risco). */
  maxActiveAgents?: number | null;
  maxAiBudgetCentsMonth?: number | null;
  maxAgentMessagesPerDay?: number | null;
  maxLeadSearchesPerDay?: number | null;
  maxCreativesPerMonth?: number | null;
  maxMembers?: number | null;
  maxSequenceSteps?: number | null;
}

export interface PlanView {
  key: string;
  name: string;
  priceMonthlyCents: number;
  priceYearlyCents: number | null;
  limits: PlanLimits;
  selfServiceCheckout: boolean;
}

/** `null` em uma chave (ou chave ausente) = ilimitado (D-065-8). */
export function parseLimits(json: unknown): Required<PlanLimits> {
  const o = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  return {
    maxCampaigns: num(o.maxCampaigns),
    maxWhatsappInstances: num(o.maxWhatsappInstances),
    maxLeadsPerMonth: num(o.maxLeadsPerMonth),
    maxEmailAccounts: num(o.maxEmailAccounts),
    maxSendsPerDay: num(o.maxSendsPerDay),
    ...parseNewLimits(o),
  };
}

const validNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/**
 * SPEC-069a (D-069-4/9): chaves novas. Numero valido = o numero; `null` EXPLICITO = ilimitado; ausente/invalido = default do catalogo
 * (0 = fail-closed nas que custam dinheiro/risco; ilimitado nas demais).
 */
function parseNewLimits(o: Record<string, unknown>): Record<NewLimitKey, number | null> {
  const out = {} as Record<NewLimitKey, number | null>;
  for (const k of NEW_LIMIT_KEYS) {
    const v = o[k];
    out[k] = validNum(v) ? v : v === null ? null : NEW_LIMIT_CATALOG[k].absent === "zero" ? 0 : null;
  }
  return out;
}

/**
 * SPEC-069a (D-069-4): le o objeto `features` guardado dentro de `Plan.limits` (JSON). Fail-closed: so `true` literal libera; chave
 * ausente, invalida ou desconhecida = bloqueada. Retorna TODAS as chaves do catalogo.
 */
export function parseFeatures(json: unknown): Record<FeatureKey, boolean> {
  const root = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const f = root.features && typeof root.features === "object" && !Array.isArray(root.features) ? (root.features as Record<string, unknown>) : {};
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, f[k] === true])) as Record<FeatureKey, boolean>;
}

/** Planos ativos, do mais barato ao mais caro (D-33-2: preços/limites são PLACEHOLDER). */
export async function listActivePlans(): Promise<PlanView[]> {
  const rows = await prisma.plan.findMany({
    // SPEC-040 (D-040-2): plano "courtesy" (contas de cortesia criadas manualmente pelo platform_admin,
    // ver createCourtesyOrganization) nunca aparece na vitrine pública — não é atribuível por
    // self-service e não deve ser oferecido/visível na landing nem no `/signup`.
    // SPEC-065 (D-065-6): idem para o plano "free" (trial do cadastro; nunca aparece em /assinar, pricing ou PlanSelectionSection).
    where: { active: true, key: { notIn: ["courtesy", "free"] } },
    orderBy: { priceMonthlyCents: "asc" },
    select: { key: true, name: true, priceMonthlyCents: true, priceYearlyCents: true, limits: true, selfServiceCheckout: true },
  });
  // Planos "sob consulta" (sem checkout self-service) vão por último; dentro de cada grupo, do mais barato ao mais caro.
  return rows.map((r) => ({ ...r, limits: parseLimits(r.limits) })).sort((a, b) => Number(!a.selfServiceCheckout) - Number(!b.selfServiceCheckout) || a.priceMonthlyCents - b.priceMonthlyCents);
}
