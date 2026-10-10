import { AcsEmailProvider } from "./providers/acs";
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
  readonly name: "acs" | "resend" | "smtp";
  /** Lança em qualquer falha (rede, auth, rejeição, timeout do chamador) — normalizado por `system-mail.ts`. */
  send(input: EmailSendInput): Promise<EmailSendResult>;
}

export interface GetEmailProviderOptions {
  /** Testes: força o provider primário devolvido (bypassa a checagem de `RESEND_API_KEY`). */
  provider?: EmailProvider;
}

/** `true` só quando `RESEND_API_KEY` está configurada. */
export function resendConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.RESEND_API_KEY?.trim());
}

/** SPEC-048: `true` só quando a connection string do ACS está configurada. */
export function acsConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.AZURE_COMMUNICATION_CONNECTION_STRING?.trim());
}

/**
 * SPEC-048 (D-048-1): ordem dos providers. `EMAIL_PROVIDER=acs` + ACS configurado => ACS primário, depois
 * Resend (se configurado), depois SMTP. Qualquer outro caso mantém o comportamento da SPEC-046:
 * Resend (se `RESEND_API_KEY`) -> SMTP. ACS sem `EMAIL_PROVIDER=acs` nunca é usado. `smtp` sempre é o
 * último elo (D-046-2); o nome devolvido na cadeia identifica o tipo, `smtp` entra via `smtpProvider`.
 */
export function getEmailProviderChain(env: Record<string, string | undefined> = process.env, smtpProvider: EmailProvider = new SmtpEmailProvider()): EmailProvider[] {
  const chain: EmailProvider[] = [];
  const wanted = env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (wanted === "acs" && acsConfigured(env)) chain.push(new AcsEmailProvider(env.AZURE_COMMUNICATION_CONNECTION_STRING!.trim()));
  if (wanted !== "smtp" && resendConfigured(env)) chain.push(new ResendEmailProvider(env.RESEND_API_KEY!.trim()));
  chain.push(smtpProvider);
  return chain;
}

/** Provider PRIMÁRIO (primeiro elo de `getEmailProviderChain`). */
export function getEmailProvider(env: Record<string, string | undefined> = process.env, opts: GetEmailProviderOptions = {}): EmailProvider {
  if (opts.provider) return opts.provider;
  return getEmailProviderChain(env)[0];
}
