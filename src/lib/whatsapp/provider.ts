import type { WhatsAppProviderKind } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { EvolutionProvider } from "./providers/evolution";

/** Tipos neutros: nenhum formato de provider específico (Evolution etc.) vaza daqui. */
export type ConnectionState = "connected" | "connecting" | "disconnected";

export interface InboundMessage {
  kind: "inbound";
  instanceName: string;
  /** Telefone do remetente em E.164 BR (+55DDD9XXXXXXXX). */
  from: string;
  pushName: string | null;
  text: string;
  /** Id da mensagem no provider (idempotência). */
  externalId: string;
  timestamp: Date;
}

export type StatusEvent =
  | { kind: "connection"; instanceName: string; status: ConnectionState }
  | { kind: "qrcode"; instanceName: string; qrCode: string }
  | { kind: "message_status"; instanceName: string; externalId: string; status: "sent" | "delivered" | "read" | "failed" };

export type WebhookEvent = InboundMessage | StatusEvent;

export interface CreateInstanceInput {
  instanceName: string;
  /** E.164 (+55...). */
  number: string;
  /** URL completa do webhook POR INSTÂNCIA (o token vai no caminho: `buildWebhookUrl`). Contém segredo: nunca logar. */
  webhookUrl: string;
}
export interface ConfigureWebhookInput {
  instanceName: string;
  webhookUrl: string;
}
export interface CreateInstanceResult {
  /** Chave própria da instância, se o provider emitir (será cifrada). */
  apiKey?: string;
  qrCode?: string | null;
}
export interface QrResult {
  qrCode: string | null;
  pairingCode?: string | null;
}
export interface SendTextInput {
  instanceName: string;
  /** E.164 (+55...). */
  to: string;
  text: string;
}
export interface SendTextResult {
  externalId: string;
}

export interface WhatsAppProvider {
  createInstance(input: CreateInstanceInput): Promise<CreateInstanceResult>;
  getQr(instanceName: string): Promise<QrResult>;
  getStatus(instanceName: string): Promise<{ status: ConnectionState }>;
  /** NÃO idempotente: implementações não podem repetir automaticamente (evita mensagem duplicada). */
  sendText(input: SendTextInput): Promise<SendTextResult>;
  deleteInstance?(instanceName: string): Promise<void>;
  logoutInstance?(instanceName: string): Promise<void>;
  /** null = evento ignorado (grupo, fromMe, tipo sem texto, evento desconhecido). Payload malformado -> AppError validation. */
  parseWebhook(request: Request): Promise<WebhookEvent | null>;
  /** (Re)configura o webhook da instância no provider (rotação de token). Lança se o provider recusar. */
  configureWebhook(input: ConfigureWebhookInput): Promise<void>;
  /**
   * Autentica o webhook: compara em tempo constante o token do CAMINHO da URL com `webhookToken` da instância e, se o corpo
   * trouxer `apikey` e a instância tiver apiKey própria (`apiKey` em texto puro), compara também. `apikey` ausente não reprova.
   */
  verifyWebhook(request: Request, instance: { webhookToken: string; apiKey?: string | null }, presentedToken: string): Promise<boolean>;
}

/** Único ponto que conhece as implementações. Trocar de provider = novo arquivo em providers/ + valor no enum + case aqui. */
export function getWhatsAppProvider(kind: WhatsAppProviderKind): WhatsAppProvider {
  switch (kind) {
    case "evolution": {
      const baseURL = process.env.EVOLUTION_API_URL?.trim();
      const apiKey = process.env.EVOLUTION_API_KEY?.trim();
      if (!baseURL || !apiKey) throw new AppError({ code: "config", userMessage: "Evolution API não configurada (EVOLUTION_API_URL / EVOLUTION_API_KEY)." });
      return new EvolutionProvider({ baseURL, apiKey });
    }
    default:
      throw new AppError({ code: "config", userMessage: "Provider de WhatsApp não suportado." });
  }
}

/** URL pública do webhook da instância: `{APP_BASE_URL||AUTH_URL}/api/webhooks/whatsapp/{webhookToken}`. Contém o segredo. */
export function buildWebhookUrl(instance: { webhookToken: string }, env: Record<string, string | undefined> = process.env): string {
  const base = (env.APP_BASE_URL || env.AUTH_URL || "").trim().replace(/\/+$/, "");
  if (!base) throw new AppError({ code: "config", userMessage: "Defina APP_BASE_URL para montar a URL do webhook." });
  return `${base}/api/webhooks/whatsapp/${encodeURIComponent(instance.webhookToken)}`;
}
