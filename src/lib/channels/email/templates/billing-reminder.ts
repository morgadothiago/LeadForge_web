import { renderEmailLayout } from "./layout";
import type { EmailTemplate } from "./password-reset";

/**
 * SPEC-046 (conteúdo preservado 1:1 da SPEC-039, só muda o mecanismo de envio/visual) — 4 sub-tipos
 * (D-039-2), mesmo texto já aprovado, só embrulhado no layout HTML compartilhado.
 */
export type BillingReminderVariant = "trial_ending" | "past_due_started" | "auto_suspended" | "purge_warning";

const COPY: Record<BillingReminderVariant, { subject: string; body: string }> = {
  trial_ending: {
    subject: "Seu período de teste está terminando — LeadForge",
    body: "Seu período de teste gratuito termina em breve. Escolha um plano em Configurações > Assinatura para continuar usando o LeadForge sem interrupção.",
  },
  past_due_started: {
    subject: "Pagamento não identificado — LeadForge",
    body: "Não conseguimos confirmar o pagamento da sua assinatura. Você tem 7 dias para atualizar a forma de pagamento antes que sua conta seja suspensa. Acesse Configurações > Assinatura para regularizar.",
  },
  auto_suspended: {
    subject: "Sua conta foi suspensa por falta de pagamento — LeadForge",
    body: "Sua conta foi suspensa porque não identificamos o pagamento da sua assinatura dentro do prazo. Atualize a forma de pagamento em Configurações > Assinatura para reativar sua conta.",
  },
  purge_warning: {
    subject: "Seus dados serão anonimizados em 15 dias — LeadForge",
    body: "Sua assinatura está cancelada há 75 dias. Em 15 dias, os dados de contatos/leads da sua conta serão anonimizados permanentemente (retenção de 90 dias). Reative sua assinatura em Configurações > Assinatura para evitar a anonimização.",
  },
};

export function billingReminderTemplate(variant: BillingReminderVariant): EmailTemplate {
  const { subject, body } = COPY[variant];
  const bodyHtml = `<p>${body}</p>`;
  return { subject, html: renderEmailLayout({ bodyHtml, preheader: subject }), text: body };
}
