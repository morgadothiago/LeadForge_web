import { escapeHtml, renderButton, renderEmailLayout } from "./layout";
import { formatDateBR } from "./format";
import type { EmailTemplate } from "./password-reset";

/**
 * SPEC-053a (#10) — pedido de cancelamento recebido (cancelAtPeriodEnd). Coerente com `computeOrgStatus`
 * (D-053-1): o acesso segue ATIVO ate `accessUntil` (= `currentPeriodEnd`); so depois suspende.
 */
export interface CancelRequestedTemplateInput {
  planName: string;
  /** Fim do periodo ja pago = ultimo dia de acesso. */
  accessUntil: Date;
  /** `accessUntil + 90 dias` — expurgo caso nao reative. */
  purgeDate: Date;
  /** Link ABSOLUTO de Configuracoes > Assinatura (manter a assinatura). */
  link: string;
}

export function cancelRequestedTemplate({ planName, accessUntil, purgeDate, link }: CancelRequestedTemplateInput): EmailTemplate {
  const subject = "Recebemos seu pedido de cancelamento — LeadForge";
  const lines = [
    `Recebemos o pedido de cancelamento da sua assinatura do plano ${planName}. Você não será cobrado novamente.`,
    `Seu acesso continua normal até ${formatDateBR(accessUntil)} (fim do período já pago). Não há reembolso proporcional.`,
    `Depois dessa data o acesso é encerrado e seus dados ficam guardados por 90 dias (até ${formatDateBR(purgeDate)}); passado esse prazo eles são apagados/anonimizados de forma permanente.`,
    "Mudou de ideia? Antes de a data chegar, é só manter a assinatura em Configurações > Assinatura.",
  ];
  const bodyHtml = `
    ${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n    ")}
    ${renderButton("Manter minha assinatura", link)}`;
  const text = [...lines, `Manter assinatura: ${link}`].join("\n\n");
  return { subject, html: renderEmailLayout({ bodyHtml, preheader: subject }), text };
}
