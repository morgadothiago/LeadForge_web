import { escapeHtml, renderButton, renderEmailLayout } from "./layout";
import { formatDateBR } from "./format";
import type { EmailTemplate } from "./password-reset";

/** SPEC-052b (cenario `payment_recovered`): pagamento regularizado (past_due -> active). O recibo sai a parte (payment-receipt). */
export interface PaymentRecoveredTemplateInput {
  planName: string;
  nextBillingDate: Date | null;
  /** Link ABSOLUTO do app. */
  link: string;
}

export function paymentRecoveredTemplate({ planName, nextBillingDate, link }: PaymentRecoveredTemplateInput): EmailTemplate {
  const subject = "Pagamento regularizado — sua assinatura está em dia — LeadForge";
  const intro = `Recebemos o pagamento e a assinatura do plano ${planName} voltou a ficar em dia. Obrigado!`;
  const next = nextBillingDate ? `Próxima cobrança: ${formatDateBR(nextBillingDate)}.` : "";
  const bodyHtml = `
    <p>${escapeHtml(intro)}</p>
    ${next ? `<p>${escapeHtml(next)}</p>` : ""}
    ${renderButton("Abrir o LeadForge", link)}`;
  const text = [intro, next, `Acesse: ${link}`].filter(Boolean).join("\n\n");
  return { subject, html: renderEmailLayout({ bodyHtml, preheader: subject }), text };
}
