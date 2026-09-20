import { normalizeInboundText } from "@/lib/domain/whatsapp-optout";
import type { AgentOutput, EscalationRules } from "./types";

/** Guardrails DETERMINÍSTICOS aplicados no código DEPOIS do modelo (SPEC-019). Violação => blocked + handoff, nunca envio. */
export interface GuardrailInput {
  message: string;
  channel: "email" | "whatsapp";
  citedKnowledgeIds: string[];
  knowledge: { id: string; content: string }[];
  allowLinks: boolean;
  rules: Pick<EscalationRules, "forbiddenPhrases">;
  /** Lead perguntou se fala com robô/IA/humano. */
  leadAskedIfBot: boolean;
  disclosureText: string | null;
}

export const MAX_LEN = { whatsapp: 700, email: 2000 } as const;
const URL_RE = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|net|org|io|co|app|dev)(\.br)?\b/i;
const PRICE_TERMS = /\b(pre[cç]o|valor(es)?|desconto|promo[cç][aã]o|gr[aá]tis|gratuit[oa]|mensalidade|or[cç]amento|prazo|garantia|reembolso|parcel\w*)\b/i;
const MONEY_OR_PCT = /(r\$\s?\d[\d.,]*|\d+(?:[.,]\d+)?\s?%|\d+\s?(dias|horas|semanas|meses)( [uú]teis)?)/gi;
const LEGAL = /\b(contrato|cl[aá]usula|multa|indeniza\w*|processo judicial|garantimos resultado|responsabilidade legal|lgpd garante)\b/i;
const CLAIMS_HUMAN = /\b(sou (uma )?(pessoa|humano|humana)|n[aã]o sou (um )?(rob[oô]|bot|ia)|sou de carne e osso)\b/i;
const EN_WORDS = new Set(["the", "and", "you", "your", "with", "for", "are", "this", "that", "hello", "please", "we", "our"]);
const PT_WORDS = new Set(["o", "a", "os", "as", "de", "do", "da", "em", "para", "com", "que", "e", "um", "uma", "voce", "você", "ola", "olá", "nós", "nos", "seu", "sua", "é", "por", "no", "na"]);

export function askedIfBot(leadText: string): boolean {
  const n = normalizeInboundText(leadText);
  const who = /\b(voce|vc|isso|ai) (e|eh) (um |uma )?(robo|bot|ia|inteligencia artificial|humano|pessoa|maquina)\b/.test(n);
  const direct = /\b(e um robo|e robo|e um bot|e uma ia|e humano|e uma pessoa|chatgpt)\b/.test(n);
  return who || direct;
}

function facts(text: string): string[] {
  return (text.match(MONEY_OR_PCT) ?? []).map((f) => f.toLowerCase().replace(/\s+/g, ""));
}

export function isMostlyPortuguese(text: string): boolean {
  const words = text.toLowerCase().match(/[a-zà-ú]+/g) ?? [];
  if (words.length < 5) return true;
  let pt = 0, en = 0;
  for (const w of words) {
    if (PT_WORDS.has(w)) pt++;
    else if (EN_WORDS.has(w)) en++;
  }
  return en <= pt;
}

/** Retorna a lista de violações (vazia = passou). Códigos estáveis, sem conteúdo do lead. */
export function checkGuardrails(i: GuardrailInput): string[] {
  const v: string[] = [];
  const msg = i.message.trim();
  if (!msg) v.push("empty");
  if (msg.length > MAX_LEN[i.channel]) v.push("length");
  if (URL_RE.test(msg) && !i.allowLinks) v.push("url_not_allowed");
  if (!isMostlyPortuguese(msg)) v.push("language");
  if (LEGAL.test(msg)) v.push("legal_promise");
  if (CLAIMS_HUMAN.test(msg)) v.push("claims_human");
  const norm = normalizeInboundText(msg);
  for (const p of i.rules.forbiddenPhrases) if (norm.includes(normalizeInboundText(p))) { v.push("forbidden_phrase"); break; }

  const known = new Map(i.knowledge.map((k) => [k.id, k.content]));
  const cited = i.citedKnowledgeIds.filter((id) => known.has(id));
  const citedText = cited.map((id) => known.get(id)!).join("\n").toLowerCase().replace(/\s+/g, "");
  const allText = i.knowledge.map((k) => k.content).join("\n").toLowerCase().replace(/\s+/g, "");
  const msgFacts = facts(msg);
  if (PRICE_TERMS.test(msg) || msgFacts.length) {
    if (!cited.length) v.push("uncited_commercial_claim");
    for (const f of msgFacts) if (!allText.includes(f) || !citedText.includes(f)) { v.push("fact_not_in_knowledge"); break; }
  }
  if (i.leadAskedIfBot && !(i.disclosureText && msg.toLowerCase().includes(i.disclosureText.toLowerCase().slice(0, 20)))) v.push("must_disclose_ai");
  return [...new Set(v)];
}

export function applyDisclosure(message: string, text: string | null, enabled: boolean, firstTurn: boolean, leadAsked: boolean): string {
  if (!enabled || !text) return message;
  if (!firstTurn && !leadAsked) return message;
  return message.includes(text) ? message : `${text}\n\n${message}`;
}

export function validateOutputShape(o: AgentOutput, channel: "email" | "whatsapp"): string[] {
  const v: string[] = [];
  if (o.action === "send" && !o.message?.trim()) v.push("empty");
  if (o.action === "send" && channel === "email" && !o.subject?.trim()) v.push("subject_missing");
  return v;
}

/** Remove SOMENTE o link exato da call como token (não corta prefixo de URL maior, ex.: `${link}/x` ou `${link}.evil.com`). */
export function stripCallLink(message: string, link: string): string {
  const esc = link.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return message.replace(new RegExp(`(?<![\\w/@.:-])${esc}(?![\\w/?#&=%@~+:-]|\\.\\w)`, "g"), "");
}
