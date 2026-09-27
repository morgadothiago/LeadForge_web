import { escapeHtml, renderEmailLayout } from "./layout";
import { formatCentsBRL, formatDateBR } from "./format";
import type { EmailTemplate } from "./password-reset";

/**
 * SPEC-046 (NOVO, D-046-3) — disparado dentro de `processBillingEvent`
 * (`src/lib/billing/process-event.ts`) em TODA transição bem-sucedida para `active`/`trialing`,
 * incluindo troca de plano (não só o checkout inicial).
 */
export interface SubscriptionSuccessTemplateInput {
  planName: string;
  /** Valor cobrado (mensal ou anual, conforme `cadence`), em centavos. `null` só no plano de cortesia (nunca chega aqui hoje — sem checkout). */
  amountCents: number | null;
  /** `trialing`: sem cobrança ainda; `active`: já cobrado/renovando. */
  status: "trialing" | "active";
  /** Data da próxima cobrança; `null` quando o provedor ainda não informou (ex.: mock em alguns estados). */
  nextBillingDate: Date | null;
}

export function subscriptionSuccessTemplate({ planName, amountCents, status, nextBillingDate }: SubscriptionSuccessTemplateInput): EmailTemplate {
  const subject = status === "trialing" ? `Seu teste do plano ${planName} começou — LeadForge` : `Assinatura confirmada — plano ${planName} — LeadForge`;
  const planLine = `Plano: <strong>${escapeHtml(planName)}</strong>`;
  const amountLine = amountCents !== null ? `Valor: <strong>${formatCentsBRL(amountCents)}</strong>` : null;
  const nextBillingLine = nextBillingDate ? `Próxima cobrança: <strong>${formatDateBR(nextBillingDate)}</strong>` : null;

  const intro =
    status === "trialing"
      ? "Seu período de teste gratuito começou. Aproveite para explorar o LeadForge — nenhuma cobrança é feita durante o teste."
      : "Sua assinatura foi confirmada com sucesso.";

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
