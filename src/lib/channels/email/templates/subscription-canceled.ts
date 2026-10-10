import { escapeHtml, renderButton, renderEmailLayout } from "./layout";
import { formatDateBR } from "./format";
import type { EmailTemplate } from "./password-reset";

/**
 * SPEC-046/053 (#11) — cancelamento EFETIVADO (disparado por `processBillingEvent` quando a Subscription vira
 * `canceled`; para cancelamento voluntario ao fim do periodo, quem grava `canceled` e o job de efetivacao —
 * `src/lib/billing/cancel-effective.ts`). Coerente com `computeOrgStatus` (D-053-1): quando este e-mail sai o
 * acesso JA foi encerrado (`canceled` suspende na hora) — por isso o texto nunca promete acesso futuro.
 * A retencao de 90 dias conta da efetivacao (`canceledAt`), D-053-1.
 */
export interface SubscriptionCanceledTemplateInput {
  planName: string;
  /** Quando o acesso foi encerrado (fim do periodo pago ou, no cancelamento imediato/trial, o proprio cancelamento). */
  accessEndedAt: Date;
  /** `canceledAt + 90 dias` — data em que os dados sao anonimizados pelo job de expurgo. */
  purgeDate: Date;
  /** Link ABSOLUTO de Configuracoes > Assinatura (reativar). */
  link: string;
}

export function subscriptionCanceledTemplate({ planName, accessEndedAt, purgeDate, link }: SubscriptionCanceledTemplateInput): EmailTemplate {
  const subject = "Assinatura cancelada — LeadForge";
  const lines = [
    `O cancelamento da sua assinatura do plano ${planName} foi efetivado. Seu acesso foi encerrado em ${formatDateBR(accessEndedAt)}.`,
    `Seus dados ficam guardados por 90 dias. Se você não reativar a assinatura, a partir de ${formatDateBR(purgeDate)} os dados de contato dos leads, o conteúdo das mensagens, as notas e os arquivos enviados serão apagados/anonimizados de forma permanente.`,
    "Mudou de ideia? Reative sua assinatura em Configurações > Assinatura antes dessa data e continue de onde parou.",
  ];
  const bodyHtml = `
    ${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n    ")}
    ${renderButton("Reativar assinatura", link)}`;
  const text = [...lines, `Reativar: ${link}`].join("\n\n");
  return { subject, html: renderEmailLayout({ bodyHtml, preheader: subject }), text };
}
