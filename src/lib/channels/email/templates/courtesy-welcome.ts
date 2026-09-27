import { escapeHtml, renderButton, renderEmailLayout } from "./layout";
import type { EmailTemplate } from "./password-reset";

/** SPEC-046 (conteúdo preservado 1:1 da SPEC-040, só muda o mecanismo de envio/visual). */
export interface CourtesyWelcomeTemplateInput {
  link: string;
}

export function courtesyWelcomeTemplate({ link }: CourtesyWelcomeTemplateInput): EmailTemplate {
  const subject = "Bem-vindo à LeadForge — defina sua senha";
  const bodyHtml = `
    <p>Uma conta de cortesia foi criada para você na LeadForge.</p>
    <p>Acesse o botão abaixo para escolher sua senha (válido por 24 horas):</p>
    ${renderButton("Definir minha senha", link)}
    <p style="word-break:break-all;font-size:13px;color:#6b7280;">Se o botão não funcionar, copie e cole este link no navegador:<br /><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>
    <p>Se você não esperava este e-mail, ignore-o.</p>`;
  const text = `Uma conta de cortesia foi criada para você na LeadForge.\n\nAcesse o link abaixo para escolher sua senha (válido por 24 horas):\n${link}\n\nSe você não esperava este e-mail, ignore-o.`;
  return { subject, html: renderEmailLayout({ bodyHtml, preheader: "Sua conta LeadForge está pronta." }), text };
}
