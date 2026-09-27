export const STAGES = [
  "novo_lead",
  "contactado",
  "em_followup",
  "interessado",
  "reuniao_agendada",
  "fechado",
  "perdido",
] as const;
export type StageKey = (typeof STAGES)[number];

export const STAGE_LABELS: Record<StageKey, string> = {
  novo_lead: "Novo Lead",
  contactado: "Contactado",
  em_followup: "Em Follow-up",
  interessado: "Interessado",
  reuniao_agendada: "Reunião Agendada",
  fechado: "Fechado",
  perdido: "Perdido",
};

/** SPEC-037 (correção QA): valores são `var(--stage-*)` — não hex literal — para que o tom mude
 * automaticamente por tema (light/dark), lendo os tokens já recalculados por contraste AA em
 * `src/app/globals.css`, em vez de fixar sempre o mesmo hex independente do modo ativo. */
export const STAGE_COLORS: Record<StageKey, string> = {
  novo_lead: "var(--stage-novo-lead)",
  contactado: "var(--stage-contactado)",
  em_followup: "var(--stage-em-followup)",
  interessado: "var(--stage-interessado)",
  reuniao_agendada: "var(--stage-reuniao-agendada)",
  fechado: "var(--stage-fechado)",
  perdido: "var(--stage-perdido)",
};

export const CHANNELS = ["email", "whatsapp", "linkedin", "phone"] as const;
export type ChannelKey = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  phone: "Telefone",
};

/** SPEC-037 (correção QA): idem `STAGE_COLORS` — `var(--channel-*)`, não hex literal. */
export const CHANNEL_COLORS: Record<ChannelKey, string> = {
  email: "var(--channel-email)",
  whatsapp: "var(--channel-whatsapp)",
  linkedin: "var(--channel-linkedin)",
  phone: "var(--channel-phone)",
};

export const SEQUENCE_STATUS_LABELS = {
  not_started: "Não iniciada",
  active: "Ativa",
  paused_replied: "Pausada (respondeu)",
  completed: "Concluída",
  opted_out: "Descadastrado",
} as const;

export const CAMPAIGN_STATUS_LABELS = {
  active: "Ativa",
  paused: "Pausada",
  archived: "Arquivada",
} as const;
