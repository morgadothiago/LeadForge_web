import type { ChannelKey } from "@/lib/domain";

export interface TemplateOption {
  id: string;
  name: string;
  campaignId: string;
  campaignName: string;
  channel: ChannelKey;
  subject: string | null;
  body: string;
}

export interface StepDraft {
  /** chave estável de UI (id do passo salvo ou id temporário) */
  key: string;
  /** id persistido (ausente em passos novos) */
  id?: string;
  day: number;
  channel: ChannelKey;
  templateId: string | null;
}
