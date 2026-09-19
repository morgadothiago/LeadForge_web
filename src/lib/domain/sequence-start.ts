import type { Channel, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findSuppression } from "./suppression";
import { normalizeBrPhone } from "./phone";
import { isSeedBlocked } from "./seed-guard";

/**
 * Início EXPLÍCITO da sequência (SPEC-013). `not_started` nunca dispara sozinho: só startSequence/startCampaignSequences (ação humana)
 * ou a fase 0 do tick para campanhas com `autoStart=true` ativam o lead. Regras de elegibilidade num lugar só.
 */
type Db = Prisma.TransactionClient | PrismaClient;

export const STARTABLE_STATUSES = ["not_started", "paused_manual"] as const;
export const AUDIT_SOURCE = "sequence_audit";

export type IneligibleReason =
  | "campaign_inactive" | "no_sequence" | "seed" | "suppressed" | "opted_out" | "replied" | "possible_opt_out" | "no_contact" | "wrong_status";

export const REASON_LABEL: Record<IneligibleReason, string> = {
  campaign_inactive: "Campanha não está ativa.",
  no_sequence: "Campanha sem sequência definida.",
  seed: "Dado de teste (seed).",
  suppressed: "Contato na lista de supressão.",
  opted_out: "Lead descadastrado.",
  replied: "Lead já respondeu.",
  possible_opt_out: "Possível pedido de descadastro pendente de revisão.",
  no_contact: "Sem contato válido para o 1º canal da sequência.",
  wrong_status: "Sequência já iniciada ou encerrada.",
};

export interface StartLead {
  id: string;
  sequenceStatus: string;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  source: string | null;
  optedOutAt: Date | null;
  repliedAt: Date | null;
  possibleOptOut: boolean;
}
export interface StartCampaignCtx {
  status: string;
  sequenceId: string | null;
  firstChannel: Channel | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Contato compatível com o 1º canal: e-mail -> e-mail válido; whatsapp -> telefone BR válido; canal manual -> qualquer contato. */
export function hasContactFor(lead: Pick<StartLead, "email" | "phone" | "linkedin">, channel: Channel | null): boolean {
  const email = !!lead.email && EMAIL_RE.test(lead.email.trim());
  const phone = !!lead.phone && normalizeBrPhone(lead.phone).ok;
  if (channel === "email") return email;
  if (channel === "whatsapp") return phone;
  return email || phone || !!lead.linkedin?.trim();
}

/** Motivo de inelegibilidade (null = elegível). Síncrono; a supressão é consultada à parte (`suppressed`). */
export function ineligibleReason(lead: StartLead, camp: StartCampaignCtx, suppressed: boolean): IneligibleReason | null {
  if (camp.status !== "active") return "campaign_inactive";
  if (!camp.sequenceId || !camp.firstChannel) return "no_sequence";
  if (isSeedBlocked(lead)) return "seed";
  if (lead.optedOutAt || lead.sequenceStatus === "opted_out") return "opted_out";
  if (lead.repliedAt || lead.sequenceStatus === "paused_replied") return "replied";
  if (!(STARTABLE_STATUSES as readonly string[]).includes(lead.sequenceStatus)) return "wrong_status";
  if (lead.possibleOptOut) return "possible_opt_out";
  if (suppressed) return "suppressed";
  if (!hasContactFor(lead, camp.firstChannel)) return "no_contact";
  return null;
}

export async function loadCampaignCtx(campaignId: string, db: Db = prisma): Promise<StartCampaignCtx | null> {
  const c = await db.campaign.findUnique({
    where: { id: campaignId },
    select: { status: true, sequenceId: true, sequence: { select: { steps: { orderBy: { order: "asc" }, take: 1, select: { channel: true } } } } },
  });
  if (!c) return null;
  return { status: c.status, sequenceId: c.sequenceId, firstChannel: c.sequence?.steps[0]?.channel ?? null };
}

export const START_LEAD_SELECT = {
  id: true, sequenceStatus: true, email: true, phone: true, linkedin: true, source: true, optedOutAt: true, repliedAt: true, possibleOptOut: true,
} satisfies Prisma.LeadSelect;

export interface StartableSummary {
  eligibleIds: string[];
  ineligible: Partial<Record<IneligibleReason, number>>;
  ineligibleTotal: number;
}

/** Candidatos = leads da campanha em not_started/paused_manual (`onlyNotStarted`: só not_started; usado pelo autoStart, que nunca reinicia quem o usuário pausou). Separa elegíveis dos inelegíveis (contagem por motivo). */
export async function classifyStartable(campaignId: string, opts: { limit?: number; db?: Db; onlyNotStarted?: boolean } = {}): Promise<StartableSummary | null> {
  const db = opts.db ?? prisma;
  const ctx = await loadCampaignCtx(campaignId, db);
  if (!ctx) return null;
  const leads = await db.lead.findMany({
    where: { campaignId, sequenceStatus: opts.onlyNotStarted ? "not_started" : { in: [...STARTABLE_STATUSES] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    ...(opts.limit ? { take: opts.limit } : {}),
    select: START_LEAD_SELECT,
  });
  const out: StartableSummary = { eligibleIds: [], ineligible: {}, ineligibleTotal: 0 };
  for (const l of leads) {
    // Curto-circuito: só consulta supressão quando o resto já passaria.
    let reason = ineligibleReason(l, ctx, false);
    if (!reason && (await findSuppression({ email: l.email, phone: l.phone }, db))) reason = "suppressed";
    if (!reason) out.eligibleIds.push(l.id);
    else {
      out.ineligible[reason] = (out.ineligible[reason] ?? 0) + 1;
      out.ineligibleTotal++;
    }
  }
  return out;
}

/** Marcador (Touch.error) dos Touches cancelados por PARADA MANUAL; só estes são reabertos ao reiniciar (skipped por regra/supressão/limite NÃO). */
export const STOP_NOTE = "sequência parada manualmente";
const DAY_MS = 24 * 3600_000;

/**
 * not_started/paused_manual -> active com nextTouchAt=now. Idempotente (só quem ainda está iniciável). Retorna quantos mudaram.
 * REINÍCIO de lead parado (paused_manual, SPEC-013 QA M2): o step atual é REABERTO e o espaçamento relativo preservado:
 *  - Touch do step atual `skipped` COM `STOP_NOTE` volta a `scheduled` (scheduledAt=now, error=null, mesmo registro: unique leadId+stepId
 *    intacto, nunca conta duplicado nos limites de 3 toques/14 dias, pois skipped não conta). skipped por outro motivo permanece skipped;
 *  - `sequenceStartedAt` é re-ancorado em now - day(stepAtual) dias, de modo que os steps seguintes vencem em (day(seguinte) - day(atual)) dias
 *    a partir do reinício, e não todos de uma vez. (DAY_MS fixo de 24 h: sem tratamento de DST, irrelevante no Brasil.)
 */
export async function activateLeads(ids: string[], now: Date, db: Db = prisma): Promise<number> {
  if (!ids.length) return 0;
  let changed = 0;
  const paused = await db.lead.findMany({
    where: { id: { in: ids }, sequenceStatus: "paused_manual", optedOutAt: null, repliedAt: null },
    select: { id: true, currentStepOrder: true, sequenceStartedAt: true, campaign: { select: { sequenceId: true } } },
  });
  for (const l of paused) {
    const step = l.campaign.sequenceId
      ? (await db.sequenceStep.findMany({ where: { sequenceId: l.campaign.sequenceId }, orderBy: { order: "asc" }, skip: l.currentStepOrder, take: 1, select: { id: true, day: true } }))[0] ?? null
      : null;
    const r = await db.lead.updateMany({
      where: { id: l.id, sequenceStatus: "paused_manual", optedOutAt: null, repliedAt: null },
      data: {
        sequenceStatus: "active",
        nextTouchAt: now,
        ...(l.sequenceStartedAt && step ? { sequenceStartedAt: new Date(now.getTime() - step.day * DAY_MS) } : {}),
      },
    });
    if (!r.count) continue;
    changed++;
    if (step) {
      await db.touch.updateMany({
        where: { leadId: l.id, stepId: step.id, direction: "outbound", status: "skipped", error: STOP_NOTE },
        data: { status: "scheduled", scheduledAt: now, error: null },
      });
    }
  }
  const pausedIds = new Set(paused.map((l) => l.id));
  const rest = ids.filter((id) => !pausedIds.has(id));
  if (rest.length) {
    const r = await db.lead.updateMany({
      where: { id: { in: rest }, sequenceStatus: { in: [...STARTABLE_STATUSES] }, optedOutAt: null, repliedAt: null },
      data: { sequenceStatus: "active", nextTouchAt: now },
    });
    changed += r.count;
  }
  return changed;
}

export type AuditAction = "start_sequence" | "start_campaign" | "stop_sequence" | "auto_start";
/** Auditoria simples (WebhookEvent source "sequence_audit"): só ids/contagens, sem PII. */
export async function writeSequenceAudit(
  data: { action: AuditAction; campaignId: string; leadId?: string; count?: number; userId?: string | null },
  db: Db = prisma,
): Promise<void> {
  await db.webhookEvent.create({ data: { source: AUDIT_SOURCE, processedAt: new Date(), payload: { ...data, at: new Date().toISOString() } } });
}
