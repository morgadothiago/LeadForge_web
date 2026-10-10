import { escapeHtml, renderButton, renderEmailLayout } from "./layout";
import type { EmailTemplate } from "./password-reset";

/** SPEC-049 (cenário `org_invite`, padrão SPEC-046): convite nominal para entrar numa organização. */
export interface OrgInviteTemplateInput {
  link: string;
  orgName: string;
  inviterName: string;
  expiresInDays: number;
}

export function orgInviteTemplate({ link, orgName, inviterName, expiresInDays }: OrgInviteTemplateInput): EmailTemplate {
  const subject = `Convite para a organização ${orgName} — LeadForge`;
  const org = escapeHtml(orgName);
  const inviter = escapeHtml(inviterName);
  const bodyHtml = `
    <p>${inviter} convidou você para participar da organização <strong>${org}</strong> na LeadForge.</p>
    <p>Clique no botão abaixo para aceitar o convite (válido por ${expiresInDays} dias, uso único):</p>
    ${renderButton("Aceitar convite", link)}
    <p style="word-break:break-all;font-size:13px;color:#6b7280;">Se o botão não funcionar, copie e cole este link no navegador:<br /><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>
    <p>O convite só pode ser aceito com este mesmo e-mail. Se você não esperava este convite, ignore este e-mail.</p>`;
  const text = `${inviterName} convidou você para participar da organização ${orgName} na LeadForge.\n\nAcesse o link abaixo para aceitar o convite (válido por ${expiresInDays} dias, uso único):\n${link}\n\nO convite só pode ser aceito com este mesmo e-mail. Se você não esperava este convite, ignore este e-mail.`;
  return { subject, html: renderEmailLayout({ bodyHtml, preheader: `Convite para ${orgName} na LeadForge.` }), text };
}
