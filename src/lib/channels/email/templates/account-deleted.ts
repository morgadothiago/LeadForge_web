import { escapeHtml, renderEmailLayout } from "./layout";
import { ANONYMIZED_ITEMS, DELETED_ITEMS, RETAINED_ITEMS } from "@/lib/account-deletion/retention";
import type { EmailTemplate } from "./password-reset";

/**
 * SPEC-054a (#14) — conta excluida: lista o que foi apagado / anonimizado / retido por lei. As listas vem de
 * `account-deletion/retention.ts` (fonte unica compartilhada com `purge.ts`; D-054-4 pendente de validacao juridica).
 */
export function accountDeletedTemplate(): EmailTemplate {
  const subject = "Sua conta LeadForge foi excluída";
  const intro = "A exclusão da sua conta LeadForge foi concluída. Veja abaixo o que aconteceu com os seus dados.";
  const orgNote =
    "Organizações das quais você participava continuam existindo para os demais membros. Se você era o único membro, a organização segue o fluxo de cancelamento da assinatura e, 90 dias depois, os dados de contato dos leads são anonimizados.";
  const sections: Array<[string, readonly string[]]> = [
    ["Apagado", DELETED_ITEMS],
    ["Anonimizado", ANONYMIZED_ITEMS],
    ["Retido por obrigação legal", RETAINED_ITEMS],
  ];
  const bodyHtml = `
    <p>${escapeHtml(intro)}</p>
    ${sections.map(([title, items]) => `<p><strong>${escapeHtml(title)}</strong></p>\n    <ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`).join("\n    ")}
    <p>${escapeHtml(orgNote)}</p>
    <p>Você pode criar uma nova conta quando quiser. Esta ação não pode ser desfeita.</p>`;
  const text = [
    intro,
    ...sections.map(([title, items]) => `${title}:\n${items.map((i) => `- ${i}`).join("\n")}`),
    orgNote,
    "Você pode criar uma nova conta quando quiser. Esta ação não pode ser desfeita.",
  ].join("\n\n");
  return { subject, html: renderEmailLayout({ bodyHtml, preheader: "Sua conta foi excluída." }), text };
}
