import { normalizeInboundText } from "@/lib/domain/whatsapp-optout";
import { escalationRulesSchema } from "./types";

export type HandoffReason =
  | "human_request" | "sensitive_topic" | "keyword" | "low_confidence" | "max_turns" | "guardrail" | "model_handoff" | "provider_error" | "manual_takeover";

export const HANDOFF_LABEL: Record<HandoffReason, string> = {
  human_request: "Lead pediu para falar com uma pessoa",
  sensitive_topic: "Assunto sensível (preço, desconto, contrato, jurídico, reclamação ou ameaça)",
  keyword: "Palavra de escalonamento configurada",
  low_confidence: "Confiança do agente abaixo do mínimo",
  max_turns: "Limite de turnos do agente atingido",
  guardrail: "Mensagem bloqueada por guardrail",
  model_handoff: "O agente pediu ajuda humana",
  provider_error: "Falha ao consultar o provedor de IA",
  manual_takeover: "Você respondeu manualmente",
};

const HUMAN = /\b(falar com|quero falar com|chama|passa pra|atendente|humano|pessoa de verdade|alguem de verdade|gerente|vendedor)\b/;
const SENSITIVE = /\b(preco|precos|valor|quanto custa|desconto|contrato|clausula|multa|juridico|advogado|processo|procon|reclamacao|reclamar|golpe|denunci\w*|ameaca\w*|justica|indenizacao|cancelamento|reembolso)\b/;

/** Regras determinísticas sobre o TEXTO DO LEAD, antes de qualquer chamada ao modelo. */
export function inboundHandoff(leadText: string, rulesRaw: unknown): HandoffReason | null {
  const rules = escalationRulesSchema.parse(rulesRaw ?? undefined);
  const n = normalizeInboundText(leadText);
  if (rules.handoffOnHumanRequest && HUMAN.test(n)) return "human_request";
  if (SENSITIVE.test(n)) return "sensitive_topic";
  for (const k of rules.keywords) if (n.includes(normalizeInboundText(k))) return "keyword";
  return null;
}
