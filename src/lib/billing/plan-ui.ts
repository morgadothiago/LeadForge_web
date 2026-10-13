import { FEATURE_CATALOG, PLAN_DISPLAY_NAMES, PLAN_MATRIX, requiredPlanForFeature, type FeatureKey, type LimitKey, type PlanKey } from "./plan-catalog";

/**
 * SPEC-069d — apresentacao PURA (sem React/prisma) da matriz de planos: comparativo (assinatura + landing) e textos de bloqueio.
 * Tudo sai de `plan-catalog.ts` (mesma fonte do servidor): mudar um valor la muda o comparativo sem tocar neste arquivo (AC-5).
 */
export type ComparisonRow =
  | { kind: "feature"; feature: FeatureKey; label: string }
  | { kind: "limit"; limit: LimitKey; label: string; unit?: "brl_cents" | "per_day" | "per_month" };

export interface ComparisonGroup {
  title: string;
  rows: ComparisonRow[];
}

/** Linhas do comparativo, em grupos. `llm.byok` fica de fora de proposito (nao e vendido: so override/Business). */
export const COMPARISON_GROUPS: readonly ComparisonGroup[] = [
  {
    title: "Agentes de IA",
    rows: [
      { kind: "feature", feature: "agents.role.followup", label: "Agente de follow-up" },
      { kind: "feature", feature: "agents.role.sdr", label: "Agente SDR (primeiro contato)" },
      { kind: "feature", feature: "agents.role.closer", label: "Agente Closer" },
      { kind: "limit", limit: "maxActiveAgents", label: "Agentes ativos ao mesmo tempo" },
      { kind: "feature", feature: "agents.autonomy.auto", label: "Modo automático (sem aprovação)" },
      { kind: "limit", limit: "maxAiBudgetCentsMonth", label: "Teto de custo de IA", unit: "brl_cents" },
      { kind: "limit", limit: "maxAgentMessagesPerDay", label: "Mensagens por dia, por agente" },
    ],
  },
  {
    title: "Canais e envios",
    rows: [
      { kind: "limit", limit: "maxCampaigns", label: "Campanhas ativas" },
      { kind: "limit", limit: "maxWhatsappInstances", label: "Números de WhatsApp" },
      { kind: "limit", limit: "maxEmailAccounts", label: "Contas de e-mail" },
      { kind: "limit", limit: "maxSendsPerDay", label: "Envios por dia", unit: "per_day" },
      { kind: "limit", limit: "maxLeadsPerMonth", label: "Leads", unit: "per_month" },
    ],
  },
  {
    title: "Prospecção",
    rows: [
      { kind: "limit", limit: "maxLeadSearchesPerDay", label: "Buscas de leads", unit: "per_day" },
      { kind: "feature", feature: "sources.ads", label: "Google Ads e Meta Lead Ads" },
      { kind: "feature", feature: "ingest.api", label: "Entrada de leads por API (n8n)" },
    ],
  },
  {
    title: "Atendimento",
    rows: [
      { kind: "feature", feature: "inbox.reply", label: "Responder pela caixa de atendimento" },
      { kind: "feature", feature: "inbox.attachments", label: "Anexos na caixa de atendimento" },
      { kind: "feature", feature: "inbox.labels", label: "Etiquetas na caixa de atendimento" },
    ],
  },
  {
    title: "Equipe e conteúdo",
    rows: [
      { kind: "limit", limit: "maxMembers", label: "Membros da equipe" },
      { kind: "limit", limit: "maxCreativesPerMonth", label: "Criativos de vídeo", unit: "per_month" },
      { kind: "limit", limit: "maxSequenceSteps", label: "Passos por sequência" },
    ],
  },
];

export type CellKind = "yes" | "no" | "text";
export interface ComparisonCell {
  kind: CellKind;
  /** Texto legivel (tambem para leitor de tela): "Incluído", "Não inclui", "3", "Ilimitado", "R$ 50,00 por mês". */
  text: string;
}

const brl = (cents: number): string => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const SUFFIX = { per_day: " por dia", per_month: " por mês", brl_cents: "" } as const;

/** Formata o valor de UM limite numerico (`null` = ilimitado; 0 = nao inclui). */
export function formatLimitValue(value: number | null, unit?: "brl_cents" | "per_day" | "per_month"): ComparisonCell {
  if (value === null) return { kind: "text", text: "Ilimitado" };
  if (value <= 0) return { kind: "no", text: "Não inclui" };
  if (unit === "brl_cents") return { kind: "text", text: `${brl(value)} por mês` };
  return { kind: "text", text: `${value.toLocaleString("pt-BR")}${unit ? SUFFIX[unit] : ""}` };
}

export function comparisonCell(plan: PlanKey, row: ComparisonRow): ComparisonCell {
  const def = PLAN_MATRIX[plan];
  if (row.kind === "feature") return def.features[row.feature] ? { kind: "yes", text: "Incluído" } : { kind: "no", text: "Não inclui" };
  return formatLimitValue(def.limits[row.limit], row.unit);
}

export interface PlanComparison {
  columns: { key: PlanKey; name: string }[];
  groups: { title: string; rows: { label: string; cells: ComparisonCell[] }[] }[];
}

/** Comparativo (colunas = planos pedidos, na ordem dada) gerado SO da matriz do catalogo. */
export function planComparison(columns: readonly PlanKey[]): PlanComparison {
  return {
    columns: columns.map((key) => ({ key, name: PLAN_DISPLAY_NAMES[key] })),
    groups: COMPARISON_GROUPS.map((g) => ({ title: g.title, rows: g.rows.map((r) => ({ label: r.label, cells: columns.map((c) => comparisonCell(c, r)) })) })),
  };
}

/** Texto de bloqueio de uma funcionalidade ("Disponível no plano Pro"). */
export function lockedFeatureText(feature: FeatureKey): { label: string; requiredPlan: string; text: string } {
  const requiredPlan = PLAN_DISPLAY_NAMES[requiredPlanForFeature(feature)];
  return { label: FEATURE_CATALOG[feature].label, requiredPlan, text: `Disponível no plano ${requiredPlan}` };
}
