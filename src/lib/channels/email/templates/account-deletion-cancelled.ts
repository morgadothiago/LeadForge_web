import { escapeHtml, renderButton, renderEmailLayout } from "./layout";
import type { EmailTemplate } from "./password-reset";

/** SPEC-054a — exclusao cancelada: conta reativada (tambem avisa se foi outra pessoa). */
export interface AccountDeletionCancelledTemplateInput {
  /** Link ABSOLUTO para entrar. */
  loginLink: string;
}

export function accountDeletionCancelledTemplate({ loginLink }: AccountDeletionCancelledTemplateInput): EmailTemplate {
  const subject = "A exclusão da sua conta foi cancelada — LeadForge";
  const lines = [
    "A exclusão da sua conta LeadForge foi cancelada e a conta está ativa novamente. Nenhum dado foi apagado.",
    "Se não foi você quem cancelou, redefina sua senha imediatamente em \"Esqueci minha senha\".",
  ];
  const bodyHtml = `
    ${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n    ")}
    ${renderButton("Entrar na minha conta", loginLink)}`;
  const text = [...lines, `Entrar: ${loginLink}`].join("\n\n");
  return { subject, html: renderEmailLayout({ bodyHtml, preheader: "Sua conta foi reativada." }), text };
}
