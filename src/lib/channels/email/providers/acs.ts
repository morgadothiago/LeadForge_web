import { EmailClient } from "@azure/communication-email";
import { AppError } from "@/lib/errors";
import type { EmailProvider, EmailSendInput, EmailSendResult } from "../provider";

type AcsClient = Pick<EmailClient, "beginSend">;

/**
 * SPEC-048 — adapter Azure Communication Services Email. SDK oficial `@azure/communication-email`
 * (desvio registrado da regra "HTTP de saída via axios", D-048-3). Autenticação por connection string
 * (D-048-2). O envio é assíncrono (long-running operation): `beginSend` resolve quando o ACS ACEITA o
 * pedido, e isso é tratado como "enviado" — não aguardamos o poll de entrega. Erros viram `AppError`
 * PT-BR sem anexar o erro cru (pode conter endpoint/trechos da credencial) nem a connection string.
 */
export interface AcsEmailProviderOptions {
  /** Testes: cliente fake — NUNCA chama o Azure real nos testes. */
  client?: AcsClient;
}

function statusOf(e: unknown): number | undefined {
  const s = (e as { statusCode?: unknown } | null)?.statusCode;
  return typeof s === "number" ? s : undefined;
}

function normalizeAcsError(e: unknown): AppError {
  const status = statusOf(e);
  if (status === 429) {
    return new AppError({ code: "rate_limited", userMessage: "Limite de envio de e-mail excedido (ACS). Tente novamente mais tarde.", status, retryable: true });
  }
  if (status === 401 || status === 403) {
    return new AppError({ code: "unauthorized", userMessage: "Falha de autenticação no serviço de e-mail (ACS). Verifique a configuração.", status });
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return new AppError({ code: "upstream", userMessage: "O serviço de e-mail (ACS) recusou o envio.", status });
  }
  if (status !== undefined && status >= 500) {
    return new AppError({ code: "upstream", userMessage: "O serviço de e-mail (ACS) está indisponível.", status, retryable: true });
  }
  return new AppError({ code: "network", userMessage: "Não foi possível enviar o e-mail (ACS).", retryable: true });
}

export class AcsEmailProvider implements EmailProvider {
  readonly name = "acs" as const;
  private readonly client: AcsClient;

  constructor(connectionString: string, opts: AcsEmailProviderOptions = {}) {
    this.client = opts.client ?? new EmailClient(connectionString);
  }

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    try {
      const poller = await this.client.beginSend({
        senderAddress: input.from,
        content: { subject: input.subject, plainText: input.text, html: input.html },
        recipients: { to: [{ address: input.to }] },
      });
      return { messageId: poller.getOperationState().result?.id ?? "" };
    } catch (e) {
      throw normalizeAcsError(e);
    }
  }
}
