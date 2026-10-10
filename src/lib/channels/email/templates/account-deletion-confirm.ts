import { escapeHtml, renderButton, renderEmailLayout } from "./layout";
import type { EmailTemplate } from "./password-reset";

/** SPEC-054a — confirmacao do pedido de exclusao de conta (token de uso unico). */
export interface AccountDeletionConfirmTemplateInput {
  /** Link ABSOLUTO `APP_BASE_URL/conta/excluir/<token>`. */
  link: string;
  /** Validade do link em horas. */
  expiresInHours: number;
  /** Dias de arrependimento apos confirmar. */
  windowDays: number;
}

export function accountDeletionConfirmTemplate({ link, expiresInHours, windowDays }: AccountDeletionConfirmTemplateInput): EmailTemplate {
  const subject = "Confirme a exclusão da sua conta — LeadForge";
  const lines = [
    "Recebemos um pedido para excluir a sua conta LeadForge.",
    `Para confirmar, use o botão abaixo (o link vale por ${expiresInHours} horas e só pode ser usado uma vez). Depois de confirmar você ainda terá ${windowDays} dias para desistir; só então os dados são apagados ou anonimizados.`,
    "Se não foi você, ignore este e-mail e troque sua senha: nada será excluído sem esta confirmação.",
  ];
  const bodyHtml = `
    ${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n    ")}
    ${renderButton("Confirmar exclusão da conta", link)}
    <p style="word-break:break-all;font-size:13px;color:#6b7280;">Se o botão não funcionar, copie e cole este link no navegador:<br /><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`;
  const text = [...lines, `Confirmar exclusão: ${link}`].join("\n\n");
  return { subject, html: renderEmailLayout({ bodyHtml, preheader: "Confirme o pedido de exclusão da sua conta." }), text };
}
