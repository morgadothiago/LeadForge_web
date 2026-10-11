import { escapeHtml, renderButton, renderEmailLayout } from "./layout";
import type { EmailTemplate } from "./password-reset";

/**
 * SPEC-055 (cenario `welcome`, D-055-2): boas-vindas do cadastro self-service. SEM data de trial (o e-mail
 * `trial_started` da SPEC-052 e separado). Nao revela nada alem do que o proprio usuario acabou de informar.
 */
export interface WelcomeTemplateInput {
  name: string;
  link: string;
  supportEmail?: string;
}

export function welcomeTemplate({ name, link, supportEmail }: WelcomeTemplateInput): EmailTemplate {
  const subject = "Bem-vindo à LeadForge";
  const first = name.trim().split(/\s+/)[0] || "";
  const hello = first ? `Olá, ${escapeHtml(first)}!` : "Olá!";
  const helloText = first ? `Olá, ${first}!` : "Olá!";
  const support = supportEmail ? ` Se precisar de ajuda, responda a este e-mail ou escreva para ${escapeHtml(supportEmail)}.` : " Se precisar de ajuda, é só responder a este e-mail.";
  const supportText = supportEmail ? ` Se precisar de ajuda, responda a este e-mail ou escreva para ${supportEmail}.` : " Se precisar de ajuda, é só responder a este e-mail.";
  const bodyHtml = `
    <p>${hello} Sua conta na LeadForge foi criada.</p>
    <p>Próximos passos: conecte seu e-mail de envio, crie sua primeira campanha e importe seus leads.</p>
    ${renderButton("Abrir a LeadForge", link)}
    <p>${support.trim()}</p>`;
  const text = `${helloText} Sua conta na LeadForge foi criada.\n\nPróximos passos: conecte seu e-mail de envio, crie sua primeira campanha e importe seus leads.\n\nAcesse: ${link}\n\n${supportText.trim()}`;
  return { subject, html: renderEmailLayout({ bodyHtml, preheader: "Sua conta LeadForge está pronta." }), text };
}
