import nodemailer, { type Transporter } from "nodemailer";
import { AppError } from "@/lib/errors";
import { allowPrivateSmtpHosts, resolvePublicHost, type HostResolver } from "@/lib/channels/ssrf";
import type { EmailProvider, EmailSendInput, EmailSendResult } from "../provider";

/**
 * SPEC-046 — extraído de `system-mail.ts` (SPEC-038), preservando 100% a checagem anti-SSRF
 * (`resolvePublicHost`, SPEC-010) e a config lida de `SMTP_HOST/PORT/USER/PASS`. Único adapter que fala
 * SMTP/Nodemailer no projeto; erros são propagados CRUS (quem normaliza com `normalizeSmtpError` é o
 * chamador, `../../system-mail.ts`) para não duplicar/divergir esse normalizador já testado. Provider
 * também usado como FALLBACK (D-046-2) quando o Resend falha/expira, não só como primário sem
 * `RESEND_API_KEY`.
 */
export interface SystemSmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string };
  /** Presente quando conectamos no IP já checado (anti-rebinding): certificado validado contra o host original. */
  tls?: { servername: string };
}

export interface SmtpEmailProviderOptions {
  /** Testes: transport já pronto (jsonTransport/stream). */
  transport?: Transporter;
  /** Testes: substitui nodemailer.createTransport; recebe a config final (host já resolvido). */
  createTransport?: (cfg: SystemSmtpConfig) => Transporter;
  /** Testes: resolver DNS injetado para a checagem anti-SSRF. */
  resolveHost?: HostResolver;
}

/** `true` só quando `SMTP_HOST` está configurado (config obrigatória para qualquer envio transacional). */
export function systemSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim());
}

function baseConfig(): SystemSmtpConfig {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) throw new AppError({ code: "config", userMessage: "Envio de e-mail do sistema não configurado (SMTP_HOST ausente)." });
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  return { host, port, secure: port === 465, auth: user && pass ? { user, pass } : undefined };
}

export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp" as const;

  constructor(private readonly opts: SmtpEmailProviderOptions = {}) {}

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    let cfg = baseConfig();
    const ip = await resolvePublicHost(cfg.host, this.opts.resolveHost);
    if (ip !== cfg.host && !allowPrivateSmtpHosts()) cfg = { ...cfg, host: ip, tls: { servername: cfg.host } };
    const transport = this.opts.transport ?? (this.opts.createTransport ? this.opts.createTransport(cfg) : nodemailer.createTransport(cfg));
    const info = (await transport.sendMail({ from: input.from, to: input.to, subject: input.subject, html: input.html, text: input.text })) as {
      messageId?: string;
    };
    return { messageId: info.messageId ?? "" };
  }
}
