import { createHash, timingSafeEqual } from "node:crypto";
import type { AxiosInstance, AxiosRequestConfig } from "axios";
import { z } from "zod";
import { createHttpClient, type RetryOptions } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { normalizeBrPhone } from "@/lib/domain/phone";
import type {
  ConfigureWebhookInput, ConnectionState, CreateInstanceInput, CreateInstanceResult, InboundMessage, QrResult, SendTextInput, SendTextResult, StatusEvent,
  WebhookEvent, WhatsAppProvider,
} from "../provider";

const NAME = "WhatsApp (Evolution)";
const EVENTS = ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"];

export interface EvolutionOptions {
  /** Vem SÓ de env (EVOLUTION_API_URL) via factory; nunca de input de usuário (sem SSRF). */
  baseURL: string;
  apiKey: string;
  timeout?: number;
  adapter?: AxiosRequestConfig["adapter"];
  retry?: RetryOptions | false;
  rng?: () => number;
  logger?: (msg: string, meta: Record<string, unknown>) => void;
}

/** Webhook POR INSTÂNCIA. A autenticação é o token no caminho da URL; não dependemos de headers customizados (não verificados na v2.1.1). */
function webhookConfig(url: string) {
  return { enabled: true, url, byEvents: false, base64: false, events: EVENTS };
}

const createRes = z.object({
  hash: z.union([z.string(), z.object({ apikey: z.string() })]).optional(),
  qrcode: z.object({ base64: z.string().nullish() }).nullish(),
});
const qrRes = z.object({ base64: z.string().nullish(), pairingCode: z.string().nullish() });
const stateRes = z.object({ instance: z.object({ state: z.string() }) });
const sendRes = z.object({ key: z.object({ id: z.string().min(1) }) });

const jid = z.string();
const upsertData = z.object({
  key: z.object({ id: z.string().min(1).optional(), remoteJid: jid, fromMe: z.boolean().optional() }),
  pushName: z.string().nullish(),
  message: z.object({ conversation: z.string().nullish(), extendedTextMessage: z.object({ text: z.string().nullish() }).nullish() }).passthrough().nullish(),
  messageTimestamp: z.union([z.number(), z.string()]).nullish(),
});
const envelope = z.object({ event: z.string(), instance: z.string().min(1), data: z.unknown() });
const connData = z.object({ state: z.string() });
const qrData = z.object({ qrcode: z.object({ base64: z.string() }).optional(), base64: z.string().optional() });
const updData = z.object({ keyId: z.string().optional(), messageId: z.string().optional(), status: z.string() });

function invalid(): AppError {
  return new AppError({ code: "upstream", userMessage: `${NAME} devolveu uma resposta inesperada.` });
}
function parseRes<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw invalid();
  return r.data;
}
const badWebhook = () => new AppError({ code: "validation", userMessage: "Payload de webhook inválido." });

function mapState(s: string): ConnectionState {
  if (s === "open") return "connected";
  if (s === "connecting") return "connecting";
  return "disconnected";
}
function mapMsgStatus(s: string): "sent" | "delivered" | "read" | "failed" | null {
  switch (s.toUpperCase()) {
    case "SERVER_ACK": case "SENT": return "sent";
    case "DELIVERY_ACK": case "DELIVERED": return "delivered";
    case "READ": case "PLAYED": return "read";
    case "ERROR": case "FAILED": return "failed";
    default: return null;
  }
}

/** JID -> +55DDD9XXXXXXXX. Aceita JID legado sem o 9 (12 dígitos). Grupos/@lid/não-BR -> null. */
export function jidToE164(remoteJid: string): string | null {
  if (!remoteJid.endsWith("@s.whatsapp.net")) return null;
  let digits = remoteJid.split("@")[0].replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("55") && /[6-9]/.test(digits[4])) digits = `${digits.slice(0, 4)}9${digits.slice(4)}`;
  const r = normalizeBrPhone(digits);
  return r.ok ? r.e164 : null;
}

const sha = (s: string) => createHash("sha256").update(s).digest();

export class EvolutionProvider implements WhatsAppProvider {
  private readonly http: AxiosInstance;
  private readonly rng: () => number;

  constructor(opts: EvolutionOptions) {
    this.rng = opts.rng ?? Math.random;
    this.http = createHttpClient({
      name: NAME, baseURL: opts.baseURL, timeout: opts.timeout ?? 20_000, headers: { apikey: opts.apiKey },
      adapter: opts.adapter, retry: opts.retry, logger: opts.logger,
    });
  }

  async createInstance(input: CreateInstanceInput): Promise<CreateInstanceResult> {
    const { data } = await this.http.post("/instance/create", {
      instanceName: input.instanceName,
      number: input.number.replace(/\D/g, ""),
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
      webhook: webhookConfig(input.webhookUrl),
    });
    const r = parseRes(createRes, data);
    return { apiKey: typeof r.hash === "string" ? r.hash : r.hash?.apikey, qrCode: r.qrcode?.base64 ?? null };
  }

  /** PENDENTE: formato de /webhook/set/{instance} não verificado contra a v2.1.1 real (sem Evolution no ambiente de teste). */
  async configureWebhook(input: ConfigureWebhookInput): Promise<void> {
    await this.http.post(`/webhook/set/${encodeURIComponent(input.instanceName)}`, { webhook: webhookConfig(input.webhookUrl) });
  }

  async getQr(instanceName: string): Promise<QrResult> {
    const { data } = await this.http.get(`/instance/connect/${encodeURIComponent(instanceName)}`);
    const r = parseRes(qrRes, data);
    return { qrCode: r.base64 ?? null, pairingCode: r.pairingCode ?? null };
  }

  async getStatus(instanceName: string): Promise<{ status: ConnectionState }> {
    const { data } = await this.http.get(`/instance/connectionState/${encodeURIComponent(instanceName)}`);
    return { status: mapState(parseRes(stateRes, data).instance.state) };
  }

  /** POST não idempotente: sem retry automático (o client só repete métodos idempotentes; `idempotent` NUNCA é setado aqui). */
  async sendText(input: SendTextInput): Promise<SendTextResult> {
    const delay = 1200 + Math.floor(this.rng() * 1801); // 1200-3000ms de "digitando"
    const { data } = await this.http.post(`/message/sendText/${encodeURIComponent(input.instanceName)}`, {
      number: input.to.replace(/\D/g, ""), text: input.text, delay,
    });
    return { externalId: parseRes(sendRes, data).key.id };
  }

  async deleteInstance(instanceName: string): Promise<void> {
    await this.http.delete(`/instance/delete/${encodeURIComponent(instanceName)}`);
  }
  async logoutInstance(instanceName: string): Promise<void> {
    await this.http.delete(`/instance/logout/${encodeURIComponent(instanceName)}`);
  }

  async parseWebhook(request: Request): Promise<WebhookEvent | null> {
    let body: unknown;
    try {
      body = await request.clone().json();
    } catch {
      throw badWebhook();
    }
    const env = envelope.safeParse(body);
    if (!env.success) throw badWebhook();
    const { instance: instanceName, data } = env.data;
    const event = env.data.event.toLowerCase().replace(/_/g, ".");

    if (event === "messages.upsert") {
      const d = upsertData.safeParse(data);
      if (!d.success) throw badWebhook();
      const { key, message, pushName, messageTimestamp } = d.data;
      if (key.fromMe || key.remoteJid.endsWith("@g.us")) return null;
      const from = jidToE164(key.remoteJid);
      const text = message?.conversation || message?.extendedTextMessage?.text;
      if (!from || !text) return null;
      const ts = Number(messageTimestamp);
      // O payload de exemplo do PROMPT não traz key.id: id sintético estável (jid+timestamp+texto) mantém a idempotência.
      const externalId = key.id ?? `h_${sha(`${key.remoteJid}|${messageTimestamp ?? ""}|${text}`).toString("hex").slice(0, 32)}`;
      const msg: InboundMessage = {
        kind: "inbound", instanceName, from, pushName: pushName ?? null, text, externalId,
        timestamp: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date(),
      };
      return msg;
    }
    if (event === "connection.update") {
      const d = connData.safeParse(data);
      if (!d.success) throw badWebhook();
      return { kind: "connection", instanceName, status: mapState(d.data.state) } satisfies StatusEvent;
    }
    if (event === "qrcode.updated") {
      const d = qrData.safeParse(data);
      if (!d.success) throw badWebhook();
      const qr = d.data.qrcode?.base64 ?? d.data.base64;
      return qr ? ({ kind: "qrcode", instanceName, qrCode: qr } satisfies StatusEvent) : null;
    }
    if (event === "messages.update") {
      const items = Array.isArray(data) ? data : [data];
      const d = updData.safeParse(items[0]);
      if (!d.success) throw badWebhook();
      const status = mapMsgStatus(d.data.status);
      const externalId = d.data.keyId ?? d.data.messageId;
      return status && externalId ? ({ kind: "message_status", instanceName, externalId, status } satisfies StatusEvent) : null;
    }
    return null;
  }

  async verifyWebhook(request: Request, instance: { webhookToken: string; apiKey?: string | null }, presentedToken: string): Promise<boolean> {
    if (!presentedToken || !instance.webhookToken) return false;
    // Hash de tamanho fixo: comparação em tempo constante sem vazar o comprimento.
    if (!timingSafeEqual(sha(presentedToken), sha(instance.webhookToken))) return false;
    if (!instance.apiKey) return true;
    try {
      const body = (await request.clone().json()) as { apikey?: unknown } | null;
      const got = body && typeof body === "object" ? body.apikey : undefined;
      if (typeof got !== "string" || !got) return true; // ausente não reprova
      return timingSafeEqual(sha(got), sha(instance.apiKey));
    } catch {
      return true; // corpo ilegível: parseWebhook responde 400
    }
  }
}
