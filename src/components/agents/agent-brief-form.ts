import { BRIEF_LIMITS, parseBrief, type AgentBriefInput } from "@/lib/agents/brief";
import { parseLines } from "./agent-format";

/** SPEC-069f: valores do briefing no formulario (strings; listas viram linhas/linhas de campos). */
export interface BriefFormValues {
  offer: string;
  audience: string;
  signature: string;
  objections: { objection: string; answer: string }[];
  /** Um item por linha. */
  neverSay: string;
  examples: { text: string }[];
}

export function briefDefaults(raw: unknown): BriefFormValues {
  const b = parseBrief(raw);
  return {
    offer: b.offer,
    audience: b.audience,
    signature: b.signature,
    objections: b.objections.map((o) => ({ ...o })),
    neverSay: b.neverSay.join("\n"),
    examples: b.examples.map((text) => ({ text })),
  };
}

/** Corpo enviado ao servidor (o schema sanitiza e limita de novo: o servidor e a barreira). */
export function toBriefBody(v: BriefFormValues): AgentBriefInput {
  return { offer: v.offer, audience: v.audience, signature: v.signature, objections: v.objections, neverSay: parseLines(v.neverSay), examples: v.examples.map((e) => e.text) };
}

export const BRIEF_COUNTS = BRIEF_LIMITS;

/** Dicas por papel: o que faz sentido pedir ao cliente em cada agente (so texto de apoio; nada vai ao prompt sem o cliente preencher). */
export const ROLE_BRIEF_HINTS = {
  sdr: {
    intro: "O SDR faz o primeiro contato. Conte o que você vende e para quem, para a mensagem soar específica e não genérica.",
    objective: "Ex.: Despertar interesse e marcar uma conversa de 15 minutos.",
    persona: "Ex.: Consultora da Acme, simpática e direta, fala como uma pessoa do mercado local.",
  },
  followup: {
    intro: "O Follow-up retoma quem não respondeu. Foque em tom leve, sem pressão, e em como lembrar sem insistir.",
    objective: "Ex.: Retomar o contato com gentileza e oferecer uma forma fácil de responder.",
    persona: "Ex.: Assistente da Acme que dá um toque cordial, sem cobrar resposta.",
  },
  closer: {
    intro: "O Closer conversa com quem respondeu. Registre as objeções mais comuns e o que ele nunca deve prometer.",
    objective: "Ex.: Tirar dúvidas e convidar o lead para uma call.",
    persona: "Ex.: Especialista da Acme, consultivo, que conduz para a call sem empurrar.",
  },
} as const;
