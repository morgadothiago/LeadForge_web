import type { SendEmailResult } from "@/lib/channels/email";
import type { SendWhatsAppResult } from "@/lib/channels/whatsapp";
import type { Stage } from "@prisma/client";

/** Decisões PURAS do scheduler (SPEC-013): sem banco, sem relógio (o tempo entra por parâmetro). */

export const DAY_MS = 24 * 3600_000;
/** Retry de falha: 3 tentativas extras, backoff 30 min / 2 h / 6 h. */
export const RETRY_BACKOFF_MS = [30 * 60_000, 2 * 3600_000, 6 * 3600_000] as const;
export const MAX_RETRIES = RETRY_BACKOFF_MS.length;
/** Adiamento mínimo quando o canal devolve `deferred` com instante <= agora (impede laço no mesmo instante). */
export const MIN_DEFER_MS = 60_000;

export type ChannelResult = SendEmailResult | SendWhatsAppResult;

/** nextTouchAt do próximo step = início da sequência + step.day dias; sem próximo step -> null (completed). */
export function computeNextTouchAt(start: Date, next: { day: number } | null): Date | null {
  return next ? new Date(start.getTime() + next.day * DAY_MS) : null;
}

/** Instante de reagendamento válido: nunca <= agora. */
export function safeDeferAt(nextAt: Date, now: Date): Date {
  return nextAt.getTime() > now.getTime() ? nextAt : new Date(now.getTime() + MIN_DEFER_MS);
}

export interface DueLeadInput {
  id: string;
  sequenceStatus: string;
  nextTouchAt: Date | null;
  optedOutAt: Date | null;
  repliedAt: Date | null;
  createdAt: Date;
  campaignStatus: string;
  hasSequence: boolean;
}

/**
 * Leads devidos: `active` com nextTouchAt <= now, OU `not_started` (lead novo: dia 0 dispara já); campanha ativa com sequência;
 * nunca optado/respondeu. Ordem determinística (mais antigo primeiro) e teto opcional.
 */
export function pickDueLeads<T extends DueLeadInput>(leads: T[], now: Date, limit = Infinity): T[] {
  return leads
    .filter((l) => {
      if (l.campaignStatus !== "active" || !l.hasSequence || l.optedOutAt || l.repliedAt) return false;
      if (l.sequenceStatus === "not_started") return true;
      return l.sequenceStatus === "active" && l.nextTouchAt !== null && l.nextTouchAt.getTime() <= now.getTime();
    })
    .sort((a, b) => (a.nextTouchAt?.getTime() ?? a.createdAt.getTime()) - (b.nextTouchAt?.getTime() ?? b.createdAt.getTime()) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export type EndStatus = "opted_out" | "paused_replied" | "completed";
export type Decision =
  | { kind: "advance"; outcome: "sent" | "skipped_step" | "failed_final" | "timeout_no_retry" }
  | { kind: "defer"; nextAt: Date }
  | { kind: "end"; status: EndStatus | "suppressed" }
  | { kind: "retry"; attempts: number; at: Date }
  | { kind: "noop" };

export interface AfterSendCtx {
  now: Date;
  /** Falhas já registradas ANTES deste resultado. */
  attempts: number;
  /** O erro gravado no Touch começa com o marcador de timeout ("verifique antes de reenviar"). */
  needsReview: boolean;
}

/** O que fazer com o retorno tipado do canal. `suppressed` é resolvido pelo executor (classifica opt-out x bounce). */
export function decideAfterSend(r: ChannelResult, ctx: AfterSendCtx): Decision {
  switch (r.status) {
    case "sent":
      return { kind: "advance", outcome: "sent" };
    case "already_sent":
      return { kind: "noop" };
    case "deferred":
      return { kind: "defer", nextAt: safeDeferAt(r.nextAt, ctx.now) };
    case "skipped":
      if (r.reason === "opted_out") return { kind: "end", status: "opted_out" };
      if (r.reason === "replied") return { kind: "end", status: "paused_replied" };
      if (r.reason === "sequence_completed") return { kind: "end", status: "completed" };
      if (r.reason === "suppressed") return { kind: "end", status: "suppressed" };
      return { kind: "advance", outcome: "skipped_step" }; // no_whatsapp | touch_limit: fallback para o próximo step
    case "failed":
      if (ctx.needsReview) return { kind: "advance", outcome: "timeout_no_retry" };
      if (ctx.attempts < MAX_RETRIES) return { kind: "retry", attempts: ctx.attempts + 1, at: new Date(ctx.now.getTime() + RETRY_BACKOFF_MS[ctx.attempts]) };
      return { kind: "advance", outcome: "failed_final" };
  }
}

const RANK: Record<Stage, number> = { novo_lead: 0, contactado: 1, em_followup: 2, interessado: 3, reuniao_agendada: 4, fechado: 5, perdido: 5 };

/** Stage alvo após um envio: 1º toque enviado -> contactado; seguintes -> em_followup. Só avança (forward-only); null = não mexer. */
export function decideStage(current: Stage, sentCount: number): Stage | null {
  const target: Stage = sentCount <= 1 ? "contactado" : "em_followup";
  return RANK[current] < RANK[target] ? target : null;
}
