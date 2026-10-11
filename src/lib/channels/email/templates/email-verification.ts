import { escapeHtml, renderButton, renderEmailLayout } from "./layout";
import type { EmailTemplate } from "./password-reset";

/** SPEC-055 (cenario `email_verification`, D-055-8): link de uso unico, valido por 24 horas. */
export interface EmailVerificationTemplateInput {
  link: string;
}

export function emailVerificationTemplate({ link }: EmailVerificationTemplateInput): EmailTemplate {
  const subject = "Confirme seu e-mail — LeadForge";
  const bodyHtml = `
    <p>Para ativar o envio de mensagens na sua conta LeadForge, confirme este endereço de e-mail.</p>
    <p>Clique no botão abaixo (válido por 24 horas, uso único):</p>
    ${renderButton("Confirmar e-mail", link)}
    <p style="word-break:break-all;font-size:13px;color:#6b7280;">Se o botão não funcionar, copie e cole este link no navegador:<br /><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>
    <p>Se você não criou uma conta na LeadForge, ignore este e-mail.</p>`;
  const text = `Para ativar o envio de mensagens na sua conta LeadForge, confirme este endereço de e-mail.\n\nAcesse o link abaixo (válido por 24 horas, uso único):\n${link}\n\nSe você não criou uma conta na LeadForge, ignore este e-mail.`;
  return { subject, html: renderEmailLayout({ bodyHtml, preheader: "Confirme seu e-mail na LeadForge." }), text };
}
