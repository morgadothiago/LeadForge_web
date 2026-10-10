import { escapeHtml, renderButton, renderEmailLayout } from "./layout";
import { formatCentsBRL, formatDateBR } from "./format";
import type { EmailTemplate } from "./password-reset";

/** SPEC-052b (cenario `renewal_upcoming`): aviso 7 dias antes da proxima cobranca (planos anuais e PIX). */
export interface RenewalUpcomingTemplateInput {
  planName: string;
  amountCents: number | null;
  renewalDate: Date;
  cadence: "monthly" | "yearly";
  paymentMethod: "card" | "pix" | null;
  /** Link ABSOLUTO da pagina de assinatura. */
  link: string;
}

export function renewalUpcomingTemplate(i: RenewalUpcomingTemplateInput): EmailTemplate {
  const subject = `Sua assinatura renova em breve — plano ${i.planName} — LeadForge`;
  const intro = `A próxima cobrança do plano ${i.planName} (${i.cadence === "yearly" ? "anual" : "mensal"}) está prevista para ${formatDateBR(i.renewalDate)}.`;
  const amount = i.amountCents != null ? `Valor previsto: ${formatCentsBRL(i.amountCents)}.` : "";
  const pix = i.paymentMethod === "pix" ? "O pagamento é feito via PIX: acompanhe a cobrança em Configurações > Assinatura." : "Não é preciso fazer nada se a forma de pagamento estiver em dia.";
  const bodyHtml = `
    <p>${escapeHtml(intro)}</p>
    ${amount ? `<p>${escapeHtml(amount)}</p>` : ""}
    <p>${escapeHtml(pix)}</p>
    ${renderButton("Ver minha assinatura", i.link)}`;
  const text = [intro, amount, pix, `Assinatura: ${i.link}`].filter(Boolean).join("\n\n");
  return { subject, html: renderEmailLayout({ bodyHtml, preheader: subject }), text };
}
