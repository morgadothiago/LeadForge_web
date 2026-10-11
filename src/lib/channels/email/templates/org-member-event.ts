import { escapeHtml, renderButton, renderEmailLayout } from "./layout";
import { formatDateBR } from "./format";
import type { EmailTemplate } from "./password-reset";

/** SPEC-056: e-mails aos owners sobre eventos de equipe (entrou / saiu / removido / papel alterado). */
export type OrgMemberEventKind = "joined" | "left" | "removed" | "role_changed";

export interface OrgMemberEventTemplateInput {
  kind: OrgMemberEventKind;
  orgName: string;
  memberName: string;
  memberEmail: string;
  date: Date;
  link: string;
  /** Papel resultante (joined/role_changed). */
  orgRole?: "owner" | "member";
  /** Papel anterior (role_changed). */
  fromRole?: "owner" | "member";
}

const roleLabel = (r: "owner" | "member"): string => (r === "owner" ? "owner" : "membro");

export function orgMemberEventTemplate(i: OrgMemberEventTemplateInput): EmailTemplate {
  const who = `${i.memberName} (${i.memberEmail})`;
  let subject: string;
  let sentence: string;
  switch (i.kind) {
    case "joined":
      subject = `Novo membro na organização ${i.orgName} — LeadForge`;
      sentence = `${who} entrou na organização ${i.orgName}${i.orgRole ? ` como ${roleLabel(i.orgRole)}` : ""}.`;
      break;
    case "left":
      subject = `Um membro saiu da organização ${i.orgName} — LeadForge`;
      sentence = `${who} saiu da organização ${i.orgName}.`;
      break;
    case "removed":
      subject = `Um membro foi removido da organização ${i.orgName} — LeadForge`;
      sentence = `${who} foi removido da organização ${i.orgName}.`;
      break;
    case "role_changed":
      subject = `Papel de membro alterado em ${i.orgName} — LeadForge`;
      sentence = `O papel de ${who} na organização ${i.orgName} mudou${i.fromRole && i.orgRole ? ` de ${roleLabel(i.fromRole)} para ${roleLabel(i.orgRole)}` : ""}.`;
      break;
  }
  const when = formatDateBR(i.date);
  const bodyHtml = `
    <p>${escapeHtml(sentence)}</p>
    <p>Data: ${escapeHtml(when)}.</p>
    ${renderButton("Ver equipe", i.link)}
    <p style="word-break:break-all;font-size:13px;color:#6b7280;">Se o botão não funcionar, copie e cole este link no navegador:<br /><a href="${escapeHtml(i.link)}">${escapeHtml(i.link)}</a></p>
    <p>Você recebeu este aviso por ser owner desta organização. Se algo parece errado, revise a equipe.</p>`;
  const text = `${sentence}\n\nData: ${when}.\n\nVer equipe: ${i.link}\n\nVocê recebeu este aviso por ser owner desta organização. Se algo parece errado, revise a equipe.`;
  return { subject, html: renderEmailLayout({ bodyHtml, preheader: sentence }), text };
}
