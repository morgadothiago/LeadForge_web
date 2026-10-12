import { escapeHtml, renderButton, renderEmailLayout } from "./layout";
import type { EmailTemplate } from "./password-reset";

/** SPEC-062 (D-062-19, cenario `org_setup_reminder`): plano pago, mas a organizacao ainda nao foi criada. D+1/D+3/D+7. */
export type OrgSetupReminderStep = "d1" | "d3" | "d7";

export interface OrgSetupReminderTemplateInput {
  step: OrgSetupReminderStep;
  planName: string;
  /** Link ABSOLUTO para `/organizacao/nova`. */
  link: string;
}

export function orgSetupReminderTemplate({ step, planName, link }: OrgSetupReminderTemplateInput): EmailTemplate {
  const subject = step === "d7" ? "Último lembrete: falta criar a sua organização — LeadForge" : "Seu plano está pago — falta criar a sua organização — LeadForge";
  const intro = `Seu plano ${planName} já está pago, mas você ainda não criou a sua organização. Dê um nome a ela para começar a usar a LeadForge.`;
  const note = "A cobrança continua normalmente. Se você não quiser mais o plano, cancele em Minha conta.";
  const bodyHtml = `
    <p>${escapeHtml(intro)}</p>
    ${renderButton("Criar minha organização", link)}
    <p>${escapeHtml(note)}</p>`;
  const text = [intro, `Criar minha organização: ${link}`, note].join("\n\n");
  return { subject, html: renderEmailLayout({ bodyHtml, preheader: subject }), text };
}
