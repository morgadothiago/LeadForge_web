import { escapeHtml, renderButton, renderEmailLayout } from "./layout";
import { formatCentsBRL, formatDateBR } from "./format";
import type { EmailTemplate } from "./password-reset";

/**
 * SPEC-052b (cenario `payment_failed`): falha de cobranca. `d0` sai NO evento `payment.failed` (ou no fallback
 * `past_due_started` do job, mesma chave); `d3`/`d5`/`d7` sao a regua ancorada em `pastDueSince` (D-052-4,
 * igual cartao e PIX). `d7` = ultimo aviso antes de suspender (grace 7d inalterado, D-039-3).
 * Sem dado sensivel: cartao so 4 digitos. Link ABSOLUTO (APP_BASE_URL).
 */
export type PaymentFailedStep = "d0" | "d3" | "d5" | "d7";

export interface PaymentFailedTemplateInput {
  step: PaymentFailedStep;
  planName: string;
  /** Valor da cobranca (do provedor ou do Plan como fallback); omitido se null. */
  amountCents?: number | null;
  paymentMethod?: "card" | "pix" | null;
  cardLast4?: string | null;
  /** Data em que a conta sera suspensa se nada mudar (pastDueSince + grace). */
  suspendDate: Date | null;
  /** Link ABSOLUTO da pagina de assinatura. */
  link: string;
}

const SUBJECT: Record<PaymentFailedStep, string> = {
  d0: "Não conseguimos processar seu pagamento — LeadForge",
  d3: "Lembrete: pagamento pendente — LeadForge",
  d5: "Seu pagamento continua pendente — LeadForge",
  d7: "Último aviso: sua conta será suspensa — LeadForge",
};

const INTRO: Record<PaymentFailedStep, string> = {
  d0: "Não conseguimos processar o pagamento da sua assinatura.",
  d3: "Ainda não identificamos o pagamento da sua assinatura (3 dias desde a falha).",
  d5: "O pagamento da sua assinatura continua pendente (5 dias desde a falha).",
  d7: "Este é o último aviso: o pagamento da sua assinatura continua pendente e sua conta será suspensa.",
};

export function paymentFailedTemplate(i: PaymentFailedTemplateInput): EmailTemplate {
  const last4 = i.cardLast4 && /^\d{4}$/.test(i.cardLast4) ? i.cardLast4 : null;
  const method = i.paymentMethod === "pix" ? "PIX" : i.paymentMethod === "card" ? (last4 ? `Cartão final ${last4}` : "Cartão") : null;
  const rows: Array<[string, string]> = [["Plano", i.planName]];
  if (i.amountCents != null) rows.push(["Valor", formatCentsBRL(i.amountCents)]);
  if (method) rows.push(["Forma de pagamento", method]);
  const suspend = i.suspendDate
    ? `Para evitar a suspensão da conta, regularize até ${formatDateBR(i.suspendDate)}.`
    : "Regularize o pagamento para evitar a suspensão da conta.";
  const subject = SUBJECT[i.step];
  const intro = INTRO[i.step];
  const action = "Acesse Configurações > Assinatura para atualizar a forma de pagamento ou pagar.";

  const bodyHtml = `
    <p>${escapeHtml(intro)}</p>
    <ul style="padding-left:20px;margin:16px 0;">${rows.map(([k, v]) => `<li>${escapeHtml(k)}: <strong>${escapeHtml(v)}</strong></li>`).join("")}</ul>
    <p>${escapeHtml(suspend)}</p>
    ${renderButton("Regularizar pagamento", i.link)}
    <p>${escapeHtml(action)}</p>`;
  const text = `${intro}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${suspend}\n\nRegularize em: ${i.link}\n\n${action}`;
  return { subject, html: renderEmailLayout({ bodyHtml, preheader: subject }), text };
}
