import { escapeHtml, renderButton, renderEmailLayout } from "./layout";

/**
 * SPEC-046 (conteúdo preservado 1:1 da SPEC-038, só muda o mecanismo de envio/visual) — usado tanto
 * pelo fluxo de "esqueci minha senha" (`src/lib/actions/auth.ts`) quanto pelo e-mail de definição de
 * senha da conta de cortesia reaproveita o MESMO link de redefinição, mas com assunto/corpo próprios
 * (ver `courtesy-welcome.ts`) — este template é só o de "esqueci minha senha".
 */
export interface PasswordResetTemplateInput {
  link: string;
}

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

export function passwordResetTemplate({ link }: PasswordResetTemplateInput): EmailTemplate {
  const subject = "Redefinição de senha — LeadForge";
  const bodyHtml = `
    <p>Recebemos um pedido para redefinir a senha da sua conta LeadForge.</p>
    <p>Se foi você, clique no botão abaixo para escolher uma nova senha (válido por 24 horas):</p>
    ${renderButton("Redefinir senha", link)}
    <p style="word-break:break-all;font-size:13px;color:#6b7280;">Se o botão não funcionar, copie e cole este link no navegador:<br /><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>
    <p>Se você não pediu isso, ignore este e-mail — sua senha atual continua válida.</p>`;
  const text = `Recebemos um pedido para redefinir a senha da sua conta LeadForge.\n\nSe foi você, acesse o link abaixo para escolher uma nova senha (válido por 24 horas):\n${link}\n\nSe você não pediu isso, ignore este e-mail — sua senha atual continua válida.`;
  return { subject, html: renderEmailLayout({ bodyHtml, preheader: "Redefina sua senha LeadForge." }), text };
}
