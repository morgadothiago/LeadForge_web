import { escapeHtml, renderButton, renderEmailLayout } from "./layout";
import { formatDateBR } from "./format";
import type { EmailTemplate } from "./password-reset";

/** SPEC-053a (#12) — reativacao confirmada (cancelamento agendado desfeito). Acesso nunca foi interrompido. */
export interface SubscriptionReactivatedTemplateInput {
  planName: string;
  nextBillingDate: Date | null;
  /** Link ABSOLUTO do app. */
  link: string;
}

export function subscriptionReactivatedTemplate({ planName, nextBillingDate, link }: SubscriptionReactivatedTemplateInput): EmailTemplate {
  const subject = "Sua assinatura foi mantida — LeadForge";
  const lines = [
    `Pronto! O cancelamento foi desfeito e sua assinatura do plano ${planName} continua ativa.`,
    nextBillingDate ? `Próxima cobrança: ${formatDateBR(nextBillingDate)}.` : "",
  ].filter(Boolean);
  const bodyHtml = `
    ${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n    ")}
    ${renderButton("Abrir o LeadForge", link)}`;
  const text = [...lines, `Acesse: ${link}`].join("\n\n");
  return { subject, html: renderEmailLayout({ bodyHtml, preheader: subject }), text };
}
