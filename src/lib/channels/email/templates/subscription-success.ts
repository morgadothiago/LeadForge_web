import { escapeHtml, renderEmailLayout } from "./layout";
import { formatCentsBRL, formatDateBR } from "./format";
import type { EmailTemplate } from "./password-reset";

/**
 * SPEC-046 (NOVO) / revisado na SPEC-052a — disparado por `processBillingEvent` SOMENTE na 1a ativacao
 * (classe `activated`). Renovacao -> `payment-receipt`; inicio de trial -> `trial-started`.
 */
export interface SubscriptionSuccessTemplateInput {
  planName: string;
  /** Valor cobrado (mensal ou anual, conforme `cadence`), em centavos. `null` só no plano de cortesia (nunca chega aqui hoje — sem checkout). */
  amountCents: number | null;
  /** Data da próxima cobrança; `null` quando o provedor ainda não informou (ex.: mock em alguns estados). */
  nextBillingDate: Date | null;
}

export function subscriptionSuccessTemplate({ planName, amountCents, nextBillingDate }: SubscriptionSuccessTemplateInput): EmailTemplate {
  const subject = `Assinatura confirmada — plano ${planName} — LeadForge`;
  const planLine = `Plano: <strong>${escapeHtml(planName)}</strong>`;
  const amountLine = amountCents !== null ? `Valor: <strong>${formatCentsBRL(amountCents)}</strong>` : null;
  const nextBillingLine = nextBillingDate ? `Próxima cobrança: <strong>${formatDateBR(nextBillingDate)}</strong>` : null;

  const intro = "Sua assinatura foi confirmada com sucesso.";

  const linesHtml = [planLine, amountLine, nextBillingLine]
    .filter((l): l is string => Boolean(l))
    .map((l) => `<li>${l}</li>`)
    .join("");

  const bodyHtml = `
    <p>${intro}</p>
    <ul style="padding-left:20px;margin:16px 0;">${linesHtml}</ul>
    <p>Você pode acompanhar os detalhes da sua assinatura a qualquer momento em Configurações > Assinatura.</p>`;

  const textLines = [
    `Plano: ${planName}`,
    amountCents !== null ? `Valor: ${formatCentsBRL(amountCents)}` : null,
    nextBillingDate ? `Próxima cobrança: ${formatDateBR(nextBillingDate)}` : null,
  ].filter((l): l is string => Boolean(l));
  const text = `${intro}\n\n${textLines.join("\n")}\n\nVocê pode acompanhar os detalhes da sua assinatura a qualquer momento em Configurações > Assinatura.`;

  return { subject, html: renderEmailLayout({ bodyHtml, preheader: subject }), text };
}
