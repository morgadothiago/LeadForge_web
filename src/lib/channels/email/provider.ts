import { ResendEmailProvider } from "./providers/resend";
import { SmtpEmailProvider } from "./providers/smtp";

/**
 * SPEC-046 — interface trocável para envio de e-mail transacional, mesmo padrão arquitetural de
 * `PaymentProvider` (D-33-5, `src/lib/billing/provider.ts`/`provider-factory.ts`). `sendSystemEmail`
 * (`../system-mail.ts`) é o ÚNICO chamador de `getEmailProvider` — os 5 callsites de e-mail do sistema
 * (esqueci-senha, lembretes de cobrança, boas-vindas de cortesia, assinatura efetuada, assinatura
 * cancelada) nunca importam `providers/resend.ts`/`providers/smtp.ts` diretamente, só `sendSystemEmail`.
 */
export interface EmailSendInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  from: string;
}

export interface EmailSendResult {
  messageId: string;
}

export interface EmailProvider {
  readonly name: "resend" | "smtp";
  /** Lança em qualquer falha (rede, auth, rejeição, timeout do chamador) — normalizado por `system-mail.ts`. */
  send(input: EmailSendInput): Promise<EmailSendResult>;
}

export interface GetEmailProviderOptions {
  /** Testes: força o provider primário devolvido (bypassa a checagem de `RESEND_API_KEY`). */
  provider?: EmailProvider;
}

/** `true` só quando `RESEND_API_KEY` está configurada — decide se o provider PRIMÁRIO é Resend ou SMTP direto. */
export function resendConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.RESEND_API_KEY?.trim());
}

/**
 * Provider PRIMÁRIO: Resend se `RESEND_API_KEY` estiver setada, senão SMTP direto (sem chave nenhuma
 * tentativa de Resend é feita — nunca erro fatal por chave ausente). `sendSystemEmail` (D-046-2) SEMPRE
 * mantém, à parte, um `SmtpEmailProvider` de FALLBACK para erro/timeout do Resend, mesmo quando o
 * primário aqui já é SMTP (nesse caso não há fallback: já é o próprio SMTP).
 */
export function getEmailProvider(env: Record<string, string | undefined> = process.env, opts: GetEmailProviderOptions = {}): EmailProvider {
  if (opts.provider) return opts.provider;
  const apiKey = env.RESEND_API_KEY?.trim();
  if (apiKey) return new ResendEmailProvider(apiKey);
  return new SmtpEmailProvider();
}
