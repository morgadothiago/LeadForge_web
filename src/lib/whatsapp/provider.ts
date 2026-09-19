import type { WhatsAppProviderKind } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { getIntegrationConfig } from "@/lib/integrations/config";
import { assertAllowedHost, parseIntegrationUrl, pinnedAgents } from "@/lib/integrations/url-guard";
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
  | { kind: "connection"; instanceName: string; status: ConnectionState; /** Logout real confirmado pelo provider (Evolution: statusReason 401/loggedOut). */ loggedOut?: boolean }
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

export interface NumberCheck {
  /** E.164 (+55...) como enviado. */
  number: string;
  exists: boolean;
}

export interface WhatsAppProvider {
  createInstance(input: CreateInstanceInput): Promise<CreateInstanceResult>;
  getQr(instanceName: string): Promise<QrResult>;
  getStatus(instanceName: string): Promise<{ status: ConnectionState }>;
  /** NÃO idempotente: implementações não podem repetir automaticamente (evita mensagem duplicada). */
  sendText(input: SendTextInput): Promise<SendTextResult>;
  /**
   * Verifica quais números têm WhatsApp (SPEC-017). Falha (429/timeout/upstream) lança AppError: o chamador NUNCA envia às cegas.
   * Evolution: PENDENTE de verificação contra a v2.1.1 real.
   */
  checkNumbers(instanceName: string, numbers: string[]): Promise<NumberCheck[]>;
  /** Requisição leve autenticada para "Testar conexão" (SPEC-018). Lança AppError PT-BR (401/429/timeout...). */
  ping?(): Promise<void>;
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

export interface ProviderFactoryOptions {
  timeoutMs?: number;
  /** false = sem retry automático (ex.: teste de conexão). */
  retry?: false;
}

/** Evolution com configuração resolvida A CADA chamada (SPEC-018): trocar a chave/URL no painel vale sem reiniciar. */
class ResolvedEvolutionProvider implements WhatsAppProvider {
  /** parseWebhook/verifyWebhook não fazem rede: independem de configuração. */
  private static readonly offline = new EvolutionProvider({ baseURL: "http://unused.invalid", apiKey: "unused" });
  constructor(private readonly opts: ProviderFactoryOptions) {}

  private async inner(): Promise<EvolutionProvider> {
    const cfg = await getIntegrationConfig("evolution");
    const baseURL = cfg.baseUrl;
    if (!baseURL) throw new AppError({ code: "config", userMessage: "Evolution API sem URL configurada. Cadastre em Configurações > Integrações." });
    const common = { timeout: this.opts.timeoutMs, retry: this.opts.retry };
    if (cfg.origin === "env") return new EvolutionProvider({ baseURL, apiKey: cfg.reveal(), ...common }); // env é confiável (comportamento anterior)
    // Origem banco: revalida SSRF ao CONECTAR, fixa no IP checado e não segue redirecionamento.
    const u = parseIntegrationUrl(baseURL);
    const { ip, family } = await assertAllowedHost(u.hostname, cfg.allowPrivateHost);
    return new EvolutionProvider({ baseURL: u.url, apiKey: cfg.reveal(), maxRedirects: 0, ...pinnedAgents(ip, family), ...common });
  }

  async createInstance(i: CreateInstanceInput) { return (await this.inner()).createInstance(i); }
  async getQr(n: string) { return (await this.inner()).getQr(n); }
  async getStatus(n: string) { return (await this.inner()).getStatus(n); }
  async sendText(i: SendTextInput) { return (await this.inner()).sendText(i); }
  async checkNumbers(n: string, nums: string[]) { return (await this.inner()).checkNumbers(n, nums); }
  async deleteInstance(n: string) { return (await this.inner()).deleteInstance(n); }
  async logoutInstance(n: string) { return (await this.inner()).logoutInstance(n); }
  async configureWebhook(i: ConfigureWebhookInput) { return (await this.inner()).configureWebhook(i); }
  async ping() { return (await this.inner()).ping(); }
  parseWebhook(request: Request) { return ResolvedEvolutionProvider.offline.parseWebhook(request); }
  verifyWebhook(request: Request, instance: { webhookToken: string; apiKey?: string | null }, presentedToken: string) {
    return ResolvedEvolutionProvider.offline.verifyWebhook(request, instance, presentedToken);
  }
}

/**
 * Único ponto que conhece as implementações. Trocar de provider = novo arquivo em providers/ + valor no enum + case aqui.
 * A configuração (URL/chave) vem do resolvedor de integrações (banco -> fallback .env) e é lida na PRIMEIRA chamada de cada método:
 * a falta de configuração aparece como AppError `config` na chamada, não na construção.
 */
export function getWhatsAppProvider(kind: WhatsAppProviderKind, opts: ProviderFactoryOptions = {}): WhatsAppProvider {
  switch (kind) {
    case "evolution":
      return new ResolvedEvolutionProvider(opts);
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
