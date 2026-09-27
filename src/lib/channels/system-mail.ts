import type { Transporter } from "nodemailer";
import { AppError } from "@/lib/errors";
import { normalizeSmtpError } from "./smtp-errors";
import type { HostResolver } from "./ssrf";
import { getEmailProvider, resendConfigured, type EmailProvider } from "./email/provider";
import { SmtpEmailProvider, type SmtpEmailProviderOptions } from "./email/providers/smtp";
import { fromAddressForScenario, type EmailScenario } from "./email/scenario";

export type { EmailScenario } from "./email/scenario";

/**
 * SPEC-046: e-mail TRANSACIONAL do próprio sistema (esqueci-senha, lembretes de cobrança, boas-vindas
 * de cortesia, assinatura efetuada, assinatura cancelada) — diferente de `src/lib/channels/email.ts`
 * (SPEC-010), que envia por CONTA do usuário (`EmailAccount`, cifrada por tenant) para os Touches de
 * campanha. `sendSystemEmail` é a ÚNICA função pública consumida pelos callsites; ela escolhe o
 * `EmailProvider` (Resend se `RESEND_API_KEY` setada, senão SMTP — `email/provider.ts`) e NUNCA deixa de
 * tentar enviar se um provider falhar: D-046-2, qualquer falha/timeout do Resend cai automaticamente no
 * fallback SMTP (mesma checagem anti-SSRF `resolvePublicHost` e `normalizeSmtpError` de sempre,
 * extraídas para `email/providers/smtp.ts` sem alterar comportamento).
 */
export interface EmailContent {
  html: string;
  text: string;
}

export interface SendSystemEmailOptions {
  /** Testes SMTP: transport já pronto (jsonTransport/stream). */
  transport?: Transporter;
  /** Testes SMTP: substitui nodemailer.createTransport; recebe a config final (host já resolvido). */
  createTransport?: SmtpEmailProviderOptions["createTransport"];
  /** Testes SMTP: resolver DNS injetado para a checagem anti-SSRF. */
  resolveHost?: HostResolver;
  /** Testes: força o provider PRIMÁRIO (Resend fake ou SMTP fake) — bypassa a checagem de `RESEND_API_KEY`. */
  primaryProvider?: EmailProvider;
  /** Testes: força o provider de FALLBACK usado quando o primário é Resend e falha (padrão: SMTP real via env, com `transport`/`createTransport`/`resolveHost` acima já aplicados). */
  fallbackProvider?: EmailProvider;
  /**
   * D-046-2: tempo máximo (ms) esperando o Resend confirmar antes de considerar falha e cair no
   * fallback SMTP. Janela de corrida ACEITA: se o Resend aceitar a requisição mas só confirmar a entrega
   * DEPOIS do timeout, o fallback tenta enviar de qualquer forma — risco baixo e aceito de e-mail
   * duplicado nesse cenário raro (timeout-mas-entregue), documentado na SPEC-046 (D-046-2). Preferimos
   * esse trade-off a arriscar nunca entregar o e-mail.
   */
  resendTimeoutMs?: number;
}

export type SendSystemEmailResult = { ok: true; messageId: string } | { ok: false; error: AppError };

const DEFAULT_RESEND_TIMEOUT_MS = 8000;

/** `true` só quando `SMTP_HOST` está configurado (preservado da SPEC-038: usado por callers para decidir se tentam configurar o canal). */
export function systemSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim());
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error("Resend: tempo de resposta excedido."), { code: "ETIMEDOUT" })), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Envia um e-mail transacional HTML+texto (multipart). Nunca lança: qualquer falha de config/provider
 * (Resend, SMTP ou ambos) volta como `{ok:false}` — todo callsite trata o envio como best-effort e nunca
 * deixa uma falha de e-mail travar o fluxo que o disparou.
 */
export async function sendSystemEmail(
  to: string,
  subject: string,
  content: EmailContent,
  scenario: EmailScenario,
  opts: SendSystemEmailOptions = {},
): Promise<SendSystemEmailResult> {
  const from = fromAddressForScenario(scenario);
  const input = { to, subject, html: content.html, text: content.text, from };
  const smtpProvider =
    opts.fallbackProvider ?? new SmtpEmailProvider({ transport: opts.transport, createTransport: opts.createTransport, resolveHost: opts.resolveHost });
  const primary = opts.primaryProvider ?? (resendConfigured() ? getEmailProvider() : smtpProvider);

  if (primary.name === "resend") {
    try {
      const result = await withTimeout(primary.send(input), opts.resendTimeoutMs ?? DEFAULT_RESEND_TIMEOUT_MS);
      return { ok: true, messageId: result.messageId };
    } catch {
      // D-046-2: Resend falhou ou expirou — tenta o fallback SMTP antes de desistir.
      try {
        const info = await smtpProvider.send(input);
        return { ok: true, messageId: info.messageId };
      } catch (e2) {
        return { ok: false, error: normalizeSmtpError(e2) };
      }
    }
  }

  try {
    const info = await primary.send(input);
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    return { ok: false, error: normalizeSmtpError(e) };
  }
}
