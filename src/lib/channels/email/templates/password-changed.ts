import { renderButton, renderEmailLayout } from "./layout";
import type { EmailTemplate } from "./password-reset";

/**
 * SPEC-055 (cenario `password_changed`): aviso de senha alterada. Sem dado sensivel e SEM link que de acesso
 * direto a conta: o unico link leva ao pedido de redefinicao ("nao foi voce").
 */
export interface PasswordChangedTemplateInput {
  changedAt: Date;
  /** Link da pagina de "esqueci minha senha" (nao autentica; so inicia um novo reset). */
  resetLink: string;
}

function fmt(d: Date): string {
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

export function passwordChangedTemplate({ changedAt, resetLink }: PasswordChangedTemplateInput): EmailTemplate {
  const subject = "Sua senha foi alterada — LeadForge";
  const when = fmt(changedAt);
  const bodyHtml = `
    <p>A senha da sua conta LeadForge foi alterada em ${when} (horário de Brasília). Por segurança, as sessões abertas foram encerradas.</p>
    <p>Se foi você, não precisa fazer nada.</p>
    <p><strong>Não foi você?</strong> Redefina sua senha agora e fale com o suporte:</p>
    ${renderButton("Redefinir senha", resetLink)}`;
  const text = `A senha da sua conta LeadForge foi alterada em ${when} (horário de Brasília). Por segurança, as sessões abertas foram encerradas.\n\nSe foi você, não precisa fazer nada.\n\nNão foi você? Redefina sua senha agora e fale com o suporte:\n${resetLink}`;
  return { subject, html: renderEmailLayout({ bodyHtml, preheader: "Sua senha da LeadForge foi alterada." }), text };
}
