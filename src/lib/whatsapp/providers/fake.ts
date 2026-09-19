import type { NumberCheck, ConfigureWebhookInput, ConnectionState, CreateInstanceInput, CreateInstanceResult, QrResult, SendTextInput, SendTextResult, WebhookEvent, WhatsAppProvider } from "../provider";
import { AppError } from "@/lib/errors";

/** Provider em memória. Exportado SÓ para testes (a factory não o conhece). */
export class FakeWhatsAppProvider implements WhatsAppProvider {
  sent: SendTextInput[] = [];
  created: CreateInstanceInput[] = [];
  deleted: string[] = [];
  status: ConnectionState = "connected";
  /** Se definido, sendText lança este erro. */
  sendError: AppError | null = null;
  webhookToken = "";
  configured: ConfigureWebhookInput[] = [];
  /** Se definido, configureWebhook lança este erro. */
  configureError: AppError | null = null;
  next: WebhookEvent | null = null;
  /** Números SEM WhatsApp (todos os demais existem). */
  noWhatsapp = new Set<string>();
  /** Se definido, checkNumbers lança este erro. */
  checkError: AppError | null = null;
  checked: string[][] = [];
  /** Se definido, ping lança este erro. */
  pingError: AppError | null = null;
  pings = 0;
  private seq = 0;

  async ping(): Promise<void> {
    this.pings++;
    if (this.pingError) throw this.pingError;
  }

  async createInstance(input: CreateInstanceInput): Promise<CreateInstanceResult> {
    this.created.push(input);
    return { apiKey: `fake-key-${input.instanceName}`, qrCode: "data:image/png;base64,FAKE" };
  }
  async getQr(): Promise<QrResult> {
    return { qrCode: "data:image/png;base64,FAKE", pairingCode: null };
  }
  async getStatus(): Promise<{ status: ConnectionState }> {
    return { status: this.status };
  }
  async sendText(input: SendTextInput): Promise<SendTextResult> {
    if (this.sendError) throw this.sendError;
    this.sent.push(input);
    return { externalId: `fake-msg-${++this.seq}` };
  }
  async checkNumbers(_instanceName: string, numbers: string[]): Promise<NumberCheck[]> {
    if (this.checkError) throw this.checkError;
    this.checked.push(numbers);
    return numbers.map((number) => ({ number, exists: !this.noWhatsapp.has(number) }));
  }
  async deleteInstance(name: string): Promise<void> {
    this.deleted.push(name);
  }
  async logoutInstance(): Promise<void> {
    this.status = "disconnected";
  }
  async parseWebhook(): Promise<WebhookEvent | null> {
    return this.next;
  }
  async configureWebhook(input: ConfigureWebhookInput): Promise<void> {
    if (this.configureError) throw this.configureError;
    this.configured.push(input);
  }
  async verifyWebhook(_request: Request, instance: { webhookToken: string }, presentedToken: string): Promise<boolean> {
    return presentedToken === instance.webhookToken;
  }
}
