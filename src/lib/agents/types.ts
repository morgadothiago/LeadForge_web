import { z } from "zod";

/** SPEC-019: saída estruturada obrigatória do modelo. Qualquer outra forma é rejeitada (blocked + handoff). */
export const AGENT_ACTIONS = ["send", "handoff", "skip", "tag"] as const;
export const agentOutputSchema = z
  .object({
    action: z.enum(AGENT_ACTIONS),
    message: z.string().max(4000).optional(),
    subject: z.string().max(200).optional(),
    confidence: z.number().min(0).max(1),
    citedKnowledgeIds: z.array(z.string().max(100)).max(20).default([]),
    tags: z.array(z.string().max(40)).max(5).optional(),
    reasonSummary: z.string().max(500),
  })
  .strict();
export type AgentOutput = z.infer<typeof agentOutputSchema>;

/** Ferramentas: allowlist NO CÓDIGO. O modelo nunca amplia; o agente só habilita subconjunto desta lista. */
export const ALL_TOOLS = ["tag", "link"] as const;
export type AgentTool = (typeof ALL_TOOLS)[number];

export const escalationRulesSchema = z
  .object({
    keywords: z.array(z.string().min(1).max(60)).max(50).default([]),
    forbiddenPhrases: z.array(z.string().min(1).max(100)).max(50).default([]),
    handoffOnHumanRequest: z.boolean().default(true),
  })
  .default({ keywords: [], forbiddenPhrases: [], handoffOnHumanRequest: true });
export type EscalationRules = z.infer<typeof escalationRulesSchema>;

export interface AgentConfig {
  id: string;
  role: "sdr" | "followup" | "closer";
  name: string;
  active: boolean;
  persona: string;
  objective: string;
  tone: string;
  model: string;
  autonomy: "draft" | "sampled" | "auto";
  samplePercent: number;
  monthlyBudgetCents: number | null;
  dailyMessageLimit: number;
  maxTurnsPerLead: number;
  allowedTools: string[];
  escalationRules: unknown;
  minConfidence: number;
  disclosureEnabled: boolean;
  disclosureText: string | null;
  callLink: string | null;
  autoConfirmedAt: Date | null;
}

export const DEFAULT_DISCLOSURE = "Sou um assistente de IA da equipe. Se preferir falar com uma pessoa, é só pedir.";
export const MICROS_PER_CENT = 10_000;
export const BUDGET_ALERT_RATIO = 0.8;
export const DEFAULT_MODEL = "claude-haiku-4-5";
export const DRAFT_TTL_MS = 7 * 24 * 3600_000;
/** Retenção: conteúdo de AgentRun/Draft além disso é apagado (PII mínima; ver purgeAgentData). */
export const AGENT_RETENTION_DAYS = 90;
