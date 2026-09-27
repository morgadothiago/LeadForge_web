import { Resend } from "resend";
import { AppError } from "@/lib/errors";
import type { EmailProvider, EmailSendInput, EmailSendResult } from "../provider";

type ResendEmailsClient = Pick<InstanceType<typeof Resend>["emails"], "send">;

/**
 * SPEC-046 — adapter Resend (API HTTP, SDK oficial `resend` do npm). Provider PRIMÁRIO quando
 * `RESEND_API_KEY` está setada (`../provider.ts`, `getEmailProvider`). Lança `AppError` crua em
 * qualquer falha (rede ou erro reportado pela API) — quem decide o fallback SMTP (D-046-2) e o timeout
 * (janela de corrida aceita: timeout curto tratado como falha = fallback, ver `../../system-mail.ts`) é
 * SEMPRE `system-mail.ts`, nunca este adapter.
 */
export interface ResendEmailProviderOptions {
  /** Testes: cliente Resend fake — NUNCA chama a API real nos testes. */
  client?: ResendEmailsClient;
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend" as const;
  private readonly client: ResendEmailsClient;

  constructor(apiKey: string, opts: ResendEmailProviderOptions = {}) {
    this.client = opts.client ?? new Resend(apiKey).emails;
  }

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    const result = await this.client.send({
      from: input.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    if (result.error) {
      throw new AppError({
        code: "upstream",
        userMessage: "Não foi possível enviar o e-mail (Resend).",
        retryable: true,
        cause: result.error,
      });
    }
    return { messageId: result.data?.id ?? "" };
  }
}
