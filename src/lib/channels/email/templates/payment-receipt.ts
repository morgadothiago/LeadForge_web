import { escapeHtml, renderEmailLayout } from "./layout";
import { formatCentsBRL, formatDateBR } from "./format";
import type { EmailTemplate } from "./password-reset";

/**
 * SPEC-052a (cenario `payment_receipt`, D-052-1/D-052-2): recibo INFORMATIVO por mensalidade paga.
 * Nao e nota fiscal (rodape obrigatorio). Cartao: so os 4 ultimos digitos.
 */
export interface PaymentReceiptTemplateInput {
  planName: string;
  amountCents: number;
  paidAt: Date;
  paymentMethod: "card" | "pix" | null;
  /** So 4 digitos; qualquer outro formato e ignorado (nunca exibe numero completo). */
  cardLast4?: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  /** Numero do pedido/cobranca no provedor; omitido se ausente. */
  orderId?: string | null;
  /** Link ABSOLUTO (APP_BASE_URL) da pagina de assinatura. */
  link: string;
}

export const RECEIPT_FOOTER = "Este e-mail não é nota fiscal.";

export function paymentReceiptTemplate(i: PaymentReceiptTemplateInput): EmailTemplate {
  const subject = `Recibo de pagamento — plano ${i.planName} — LeadForge`;
  const last4 = i.cardLast4 && /^\d{4}$/.test(i.cardLast4) ? i.cardLast4 : null;
  const method = i.paymentMethod === "pix" ? "PIX" : i.paymentMethod === "card" ? (last4 ? `Cartão final ${last4}` : "Cartão") : null;
  const period = i.periodStart && i.periodEnd ? `${formatDateBR(i.periodStart)} a ${formatDateBR(i.periodEnd)}` : i.periodEnd ? `até ${formatDateBR(i.periodEnd)}` : null;

  const rows: Array<[string, string]> = [
    ["Plano", i.planName],
    ["Valor", formatCentsBRL(i.amountCents)],
    ["Data do pagamento", formatDateBR(i.paidAt)],
  ];
  if (method) rows.push(["Forma de pagamento", method]);
  if (period) rows.push(["Período", period]);
  if (i.orderId) rows.push(["Nº do pedido", i.orderId]);

  const bodyHtml = `
    <p>Recebemos o seu pagamento. Obrigado!</p>
    <ul style="padding-left:20px;margin:16px 0;">${rows.map(([k, v]) => `<li>${escapeHtml(k)}: <strong>${escapeHtml(v)}</strong></li>`).join("")}</ul>
    <p>Detalhes da assinatura: <a href="${escapeHtml(i.link)}">${escapeHtml(i.link)}</a></p>
    <p style="font-size:13px;color:#6b7280;">${RECEIPT_FOOTER}</p>`;
  const text = `Recebemos o seu pagamento. Obrigado!\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nDetalhes da assinatura: ${i.link}\n\n${RECEIPT_FOOTER}`;
  return { subject, html: renderEmailLayout({ bodyHtml, preheader: subject }), text };
}
