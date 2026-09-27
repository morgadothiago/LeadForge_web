import { renderEmailLayout } from "./layout";
import { formatDateBR } from "./format";
import type { EmailTemplate } from "./password-reset";

/**
 * SPEC-046 (NOVO) — disparado no mesmo ponto de `status-map.ts` (`syncOrgStatuses`/`processBillingEvent`)
 * que grava `Subscription.canceledAt`/transiciona a org para o soft-block (D-33-4). Conteúdo: confirmação
 * do cancelamento, data até quando o acesso continua (fim do período pago, se houver) e data do expurgo
 * (90 dias de retenção, D-33-4).
 */
export interface SubscriptionCanceledTemplateInput {
  planName: string;
  /** Fim do período já pago (acesso continua até lá); `null` quando o soft-block é imediato. */
  accessUntil: Date | null;
  /** `canceledAt + 90 dias` (D-33-4) — data em que os dados são anonimizados pelo job de expurgo. */
  purgeDate: Date;
}

export function subscriptionCanceledTemplate({ planName, accessUntil, purgeDate }: SubscriptionCanceledTemplateInput): EmailTemplate {
  const subject = "Assinatura cancelada — LeadForge";
  const accessLine = accessUntil
    ? `Seu acesso continua disponível até <strong>${formatDateBR(accessUntil)}</strong> (fim do período já pago).`
    : "Seu acesso foi encerrado imediatamente.";
  const accessLineText = accessUntil ? `Seu acesso continua disponível até ${formatDateBR(accessUntil)} (fim do período já pago).` : "Seu acesso foi encerrado imediatamente.";

  const bodyHtml = `
    <p>Confirmamos o cancelamento da sua assinatura do plano <strong>${planName}</strong>.</p>
    <p>${accessLine}</p>
    <p>Seus dados são mantidos por até 90 dias após o cancelamento. Se você não reativar a assinatura, eles serão anonimizados permanentemente a partir de <strong>${formatDateBR(purgeDate)}</strong>.</p>
    <p>Mudou de ideia? Reative sua assinatura a qualquer momento em Configurações > Assinatura antes dessa data.</p>`;

  const text = `Confirmamos o cancelamento da sua assinatura do plano ${planName}.\n\n${accessLineText}\n\nSeus dados são mantidos por até 90 dias após o cancelamento. Se você não reativar a assinatura, eles serão anonimizados permanentemente a partir de ${formatDateBR(purgeDate)}.\n\nMudou de ideia? Reative sua assinatura a qualquer momento em Configurações > Assinatura antes dessa data.`;

  return { subject, html: renderEmailLayout({ bodyHtml, preheader: subject }), text };
}
