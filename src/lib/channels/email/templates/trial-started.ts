import { escapeHtml, renderButton, renderEmailLayout } from "./layout";
import { formatDateBR } from "./format";
import type { EmailTemplate } from "./password-reset";

/** SPEC-052a (cenario `trial_started`): inicio do periodo de teste gratuito (signup/criar org). Separado das boas-vindas (D-052-6). */
export interface TrialStartedTemplateInput {
  planName: string;
  trialEndsAt: Date | null;
  /** Link ABSOLUTO (APP_BASE_URL) para o app. */
  link: string;
}

export function trialStartedTemplate({ planName, trialEndsAt, link }: TrialStartedTemplateInput): EmailTemplate {
  const subject = `Seu teste do plano ${planName} começou — LeadForge`;
  const endLine = trialEndsAt ? `Seu teste vai até <strong>${formatDateBR(trialEndsAt)}</strong>.` : "";
  const endText = trialEndsAt ? `Seu teste vai até ${formatDateBR(trialEndsAt)}.` : "";
  const bodyHtml = `
    <p>Seu período de teste gratuito do plano <strong>${escapeHtml(planName)}</strong> começou. Aproveite para explorar o LeadForge — nenhuma cobrança é feita durante o teste.</p>
    ${endLine ? `<p>${endLine}</p>` : ""}
    ${renderButton("Abrir o LeadForge", link)}
    <p>Você pode acompanhar a assinatura em Configurações > Assinatura.</p>`;
  const text = [
    `Seu período de teste gratuito do plano ${planName} começou. Aproveite para explorar o LeadForge — nenhuma cobrança é feita durante o teste.`,
    endText,
    `Acesse: ${link}`,
    "Você pode acompanhar a assinatura em Configurações > Assinatura.",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { subject, html: renderEmailLayout({ bodyHtml, preheader: subject }), text };
}
