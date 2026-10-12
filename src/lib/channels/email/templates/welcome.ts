import { escapeHtml, renderButton, renderEmailLayout } from "./layout";
import type { EmailTemplate } from "./password-reset";

/**
 * SPEC-055 (cenario `welcome`, D-055-2): boas-vindas do cadastro self-service. Nao revela nada alem do que o proprio
 * usuario acabou de informar. SPEC-062: nao existe trial; `nextStep: "plan"` (padrao, cadastro so com usuario) manda
 * escolher o plano (`link` = /assinar); `"app"` (entrou por convite, ja tem organizacao) mantem os passos de uso.
 */
export interface WelcomeTemplateInput {
  name: string;
  link: string;
  supportEmail?: string;
  nextStep?: "plan" | "app";
}

export function welcomeTemplate({ name, link, supportEmail, nextStep = "plan" }: WelcomeTemplateInput): EmailTemplate {
  const subject = "Bem-vindo à LeadForge";
  const first = name.trim().split(/\s+/)[0] || "";
  const hello = first ? `Olá, ${escapeHtml(first)}!` : "Olá!";
  const helloText = first ? `Olá, ${first}!` : "Olá!";
  const support = supportEmail ? ` Se precisar de ajuda, responda a este e-mail ou escreva para ${escapeHtml(supportEmail)}.` : " Se precisar de ajuda, é só responder a este e-mail.";
  const supportText = supportEmail ? ` Se precisar de ajuda, responda a este e-mail ou escreva para ${supportEmail}.` : " Se precisar de ajuda, é só responder a este e-mail.";
  const step = nextStep === "plan" ? "Próximo passo: escolha seu plano para criar a sua organização e começar a prospectar." : "Próximos passos: conecte seu e-mail de envio, crie sua primeira campanha e importe seus leads.";
  const cta = nextStep === "plan" ? "Escolher meu plano" : "Abrir a LeadForge";
  const bodyHtml = `
    <p>${hello} Sua conta na LeadForge foi criada.</p>
    <p>${step}</p>
    ${renderButton(cta, link)}
    <p>${support.trim()}</p>`;
  const text = `${helloText} Sua conta na LeadForge foi criada.\n\n${step}\n\nAcesse: ${link}\n\n${supportText.trim()}`;
  return { subject, html: renderEmailLayout({ bodyHtml, preheader: "Sua conta LeadForge está pronta." }), text };
}
