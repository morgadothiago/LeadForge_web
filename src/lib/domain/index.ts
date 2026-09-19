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

export const STAGE_COLORS: Record<StageKey, string> = {
  novo_lead: "#3b82f6",
  contactado: "#eab308",
  em_followup: "#f97316",
  interessado: "#22c55e",
  reuniao_agendada: "#a855f7",
  fechado: "#16a34a",
  perdido: "#dc2626",
};

export const CHANNELS = ["email", "whatsapp", "linkedin", "phone"] as const;
export type ChannelKey = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  phone: "Telefone",
};

export const CHANNEL_COLORS: Record<ChannelKey, string> = {
  email: "#3b82f6",
  whatsapp: "#25D366",
  linkedin: "#0077B5",
  phone: "#a855f7",
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
