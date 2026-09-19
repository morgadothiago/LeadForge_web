/** Lógica pura de texto/rotulagem do início explícito de sequências (SPEC-013). Sem dependência de servidor. */

export type SequenceStatusKey = "not_started" | "active" | "paused_replied" | "paused_manual" | "completed" | "opted_out";

/** Rótulo curto (badges/listas). Local à UI porque o mapa de src/lib/domain não cobre `paused_manual`. */
export const SEQUENCE_STATUS_TEXT: Record<SequenceStatusKey, string> = {
  not_started: "Não iniciada",
  active: "Ativa",
  paused_replied: "Pausada (respondeu)",
  paused_manual: "Pausada manualmente",
  completed: "Concluída",
  opted_out: "Descadastrado",
};

export const START_CHANNELS_WARNING =
  "As mensagens serão enviadas pelos canais configurados (e-mail/WhatsApp), sujeitas ao limite diário, janela de horário e política de envio.";

export const AUTO_START_WARNING =
  "Novos leads desta campanha começarão a receber mensagens automaticamente assim que o scheduler rodar, pelos canais configurados. Recomendamos deixar desligado e iniciar manualmente enquanto valida os canais.";

export const autoStartLabel = (autoStart: boolean): string => (autoStart ? "Automático" : "Manual");

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "X leads serão iniciados; Y não podem ser iniciados". */
export function startSummaryText(eligible: number, ineligible: number): string {
  const a = eligible === 1 ? "1 lead será iniciado" : `${eligible} leads serão iniciados`;
  const b = ineligible === 1 ? "1 não pode ser iniciado" : `${ineligible} não podem ser iniciados`;
  return `${a}; ${b}.`;
}

export interface ReasonRow {
  label: string;
  count: number;
}

/** "Rótulo (n)" ordenado por contagem desc, depois rótulo. Ignora contagens <= 0. */
export function formatReasons(rows: ReasonRow[]): string[] {
  return rows
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"))
    .map((r) => `${r.label.replace(/\.$/, "")} (${r.count})`);
}

/** Por que o botão de confirmar está bloqueado (null = liberado). */
export function startBlockedReason(c: { campaignActive: boolean; hasSequence: boolean; eligible: number }): string | null {
  if (!c.campaignActive) return "A campanha não está ativa. Retome a campanha para iniciar as sequências.";
  if (!c.hasSequence) return "A campanha não tem sequência definida. Escolha uma sequência antes de iniciar.";
  if (c.eligible === 0) return "Nenhum lead pendente pode ser iniciado agora.";
  return null;
}

export function startResultText(started: number, ineligible: number): string {
  const base = started === 0 ? "Nenhum lead foi iniciado" : `${plural(started, "lead iniciado", "leads iniciados")}`;
  return ineligible > 0 ? `${base}; ${plural(ineligible, "não pôde ser iniciado", "não puderam ser iniciados")}.` : `${base}.`;
}

export interface LeadSeqInput {
  sequenceStatus: SequenceStatusKey;
  nextTouchAt: Date | null;
  repliedAt: Date | null;
  optedOutAt: Date | null;
}
export interface LeadSeqFormatters {
  dateTime: (d: Date) => string;
  relative: (d: Date) => string;
}

/** Texto claro do status da sequência na ficha do lead. */
export function leadSequenceText(l: LeadSeqInput, f: LeadSeqFormatters): string {
  const when = (d: Date) => `${f.relative(d)} (${f.dateTime(d)})`;
  switch (l.sequenceStatus) {
    case "not_started":
      return "Sequência ainda não iniciada. Nenhuma mensagem será enviada até você iniciar.";
    case "active":
      return l.nextTouchAt ? `Sequência ativa. Próximo contato ${when(l.nextTouchAt)}.` : "Sequência ativa.";
    case "paused_manual":
      return "Você pausou esta sequência. Nenhuma mensagem será enviada até você reiniciá-la.";
    case "paused_replied":
      return `Sequência pausada: o lead respondeu${l.repliedAt ? ` ${when(l.repliedAt)}` : ""}.`;
    case "completed":
      return "Sequência concluída.";
    case "opted_out":
      return `Lead pediu para não ser contatado${l.optedOutAt ? ` ${when(l.optedOutAt)}` : ""}. Sequência encerrada.`;
  }
}

export const isSeedSource = (source: string | null | undefined): boolean => source === "seed";

/** Ações possíveis no lead: iniciar (not_started/paused_manual) e pausar (active). */
export function leadSequenceAction(status: SequenceStatusKey): "start" | "stop" | null {
  if (status === "not_started" || status === "paused_manual") return "start";
  if (status === "active") return "stop";
  return null;
}

export const NO_CHANNELS_TEXT = "Sem canais configurados";

/** Sem conta de e-mail ativa nem instância de WhatsApp conectada. */
export function hasNoChannels(emailAccounts: { isActive: boolean }[], whatsapp: { status: string }[]): boolean {
  return !emailAccounts.some((a) => a.isActive) && !whatsapp.some((w) => w.status === "connected");
}
