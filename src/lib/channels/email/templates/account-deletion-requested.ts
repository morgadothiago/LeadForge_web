import { escapeHtml, renderButton, renderEmailLayout } from "./layout";
import { formatDateBR } from "./format";
import type { EmailTemplate } from "./password-reset";

/** SPEC-054a (#13) — solicitacao de exclusao recebida/confirmada; data da exclusao e como cancelar. */
export interface AccountDeletionRequestedTemplateInput {
  /** Instante (UTC) em que a exclusao sera executada. */
  scheduledFor: Date;
  /** Link ABSOLUTO para cancelar a exclusao (`/conta/excluir/cancelar/<token>`). */
  cancelLink: string;
}

export function accountDeletionRequestedTemplate({ scheduledFor, cancelLink }: AccountDeletionRequestedTemplateInput): EmailTemplate {
  const date = formatDateBR(scheduledFor);
  const subject = "Recebemos sua solicitação de exclusão de conta — LeadForge";
  const lines = [
    `Confirmamos o pedido de exclusão da sua conta LeadForge. A exclusão será executada em ${date}.`,
    "Até lá sua conta fica bloqueada: você foi desconectado e não consegue entrar. Seus dados ainda não foram apagados.",
    `Mudou de ideia? Antes de ${date} é só cancelar a exclusão pelo botão abaixo (ou tentar entrar com e-mail e senha e escolher \"Cancelar exclusão\").`,
    "Depois dessa data a exclusão é definitiva e enviaremos outro e-mail com o que foi apagado, anonimizado e retido por obrigação legal.",
  ];
  const bodyHtml = `
    ${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n    ")}
    ${renderButton("Cancelar a exclusão", cancelLink)}`;
  const text = [...lines, `Cancelar a exclusão: ${cancelLink}`].join("\n\n");
  return { subject, html: renderEmailLayout({ bodyHtml, preheader: `Exclusão agendada para ${date}.` }), text };
}
