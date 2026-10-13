import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * SPEC-065/069 — tipos e erro tipado `plan_limit` (sem dependencias de prisma/entitlements: evita ciclo entre `limits.ts` e `entitlements.ts`).
 */
export type Db = PrismaClient | Prisma.TransactionClient;

export type LimitMetric = "campaigns" | "whatsapp" | "email_accounts" | "leads" | "sends";

/** SPEC-069a: metricas de estoque/uso novas (agentes, equipe, criativos...). Fora de `LimitMetric` para nao mexer na UI de uso da 065. */
export type ExtraLimitMetric = "agents" | "ai_budget" | "agent_messages" | "lead_searches" | "creatives" | "members" | "sequence_steps";

const MESSAGES: Record<LimitMetric, (n: number) => string> = {
  campaigns: (n) => `Seu plano permite ${n} campanha${n === 1 ? "" : "s"} ativa${n === 1 ? "" : "s"}. Pause ou arquive uma, ou faça upgrade.`,
  whatsapp: (n) => `Seu plano permite ${n} número${n === 1 ? "" : "s"} de WhatsApp. Remova um ou faça upgrade.`,
  email_accounts: (n) => `Seu plano permite ${n} conta${n === 1 ? "" : "s"} de e-mail. Remova uma ou faça upgrade.`,
  leads: (n) => `Seu plano atingiu o limite de ${n} lead${n === 1 ? "" : "s"}. Faça upgrade para continuar trazendo leads.`,
  sends: (n) => `Seu plano atingiu o limite de ${n} envio${n === 1 ? "" : "s"} por dia. Os envios continuam amanhã, ou faça upgrade.`,
};

const EXTRA_MESSAGES: Record<ExtraLimitMetric, (n: number) => string> = {
  agents: (n) => (n === 0 ? "Seu plano não inclui agentes de IA. Faça upgrade para usar." : `Seu plano permite ${n} agente${n === 1 ? "" : "s"} ativo${n === 1 ? "" : "s"} ao mesmo tempo. Pause um ou faça upgrade.`),
  ai_budget: () => "O teto de custo de IA do seu plano foi atingido. Os agentes pausam até o próximo mês, ou faça upgrade.",
  agent_messages: (n) => `Seu plano permite ${n} mensage${n === 1 ? "m" : "ns"} por dia por agente. Continua amanhã, ou faça upgrade.`,
  lead_searches: (n) => (n === 0 ? "Seu plano não inclui busca de leads. Faça upgrade para usar." : `Seu plano permite ${n} busca${n === 1 ? "" : "s"} de leads por dia. Continua amanhã, ou faça upgrade.`),
  creatives: (n) => (n === 0 ? "Seu plano não inclui criativos. Faça upgrade para usar." : `Seu plano permite ${n} criativo${n === 1 ? "" : "s"} por mês. Faça upgrade para gerar mais.`),
  members: (n) => `Seu plano permite ${n} membro${n === 1 ? "" : "s"} na equipe. Remova um ou faça upgrade.`,
  sequence_steps: (n) => `Seu plano permite ${n} passo${n === 1 ? "" : "s"} por sequência. Faça upgrade para sequências mais longas.`,
};

/** Erro tipado `plan_limit` (D-065-18). `handleActionError` o converte em `errors._form` + `code:["plan_limit"]` + `metric/limit/used`. */
export class PlanLimitError extends Error {
  readonly code = "plan_limit" as const;
  constructor(
    readonly metric: LimitMetric | ExtraLimitMetric,
    readonly limit: number,
    readonly used: number,
  ) {
    super(metric in MESSAGES ? MESSAGES[metric as LimitMetric](limit) : EXTRA_MESSAGES[metric as ExtraLimitMetric](limit));
    this.name = "PlanLimitError";
  }
}

