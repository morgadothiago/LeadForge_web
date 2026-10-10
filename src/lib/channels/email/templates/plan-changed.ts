import { escapeHtml, renderButton, renderEmailLayout } from "./layout";
import { formatCentsBRL, formatDateBR } from "./format";
import type { EmailTemplate } from "./password-reset";

/** SPEC-052b (cenario `plan_changed`, D-052-10): restaura o aviso de troca de plano removido da confirmacao pela 052a. */
export interface PlanChangedTemplateInput {
  previousPlanName: string | null;
  planName: string;
  cadence: "monthly" | "yearly";
  amountCents: number | null;
  nextBillingDate: Date | null;
  /** Link ABSOLUTO da pagina de assinatura. */
  link: string;
}

export function planChangedTemplate(i: PlanChangedTemplateInput): EmailTemplate {
  const subject = `Seu plano foi alterado para ${i.planName} — LeadForge`;
  const intro = i.previousPlanName ? `Seu plano foi alterado de ${i.previousPlanName} para ${i.planName}.` : `Seu plano foi alterado para ${i.planName}.`;
  const rows: Array<[string, string]> = [["Plano", i.planName], ["Ciclo", i.cadence === "yearly" ? "Anual" : "Mensal"]];
  if (i.amountCents != null) rows.push(["Valor", formatCentsBRL(i.amountCents)]);
  if (i.nextBillingDate) rows.push(["Próxima cobrança", formatDateBR(i.nextBillingDate)]);
  const bodyHtml = `
    <p>${escapeHtml(intro)}</p>
    <ul style="padding-left:20px;margin:16px 0;">${rows.map(([k, v]) => `<li>${escapeHtml(k)}: <strong>${escapeHtml(v)}</strong></li>`).join("")}</ul>
    ${renderButton("Ver minha assinatura", i.link)}`;
  const text = `${intro}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nAssinatura: ${i.link}`;
  return { subject, html: renderEmailLayout({ bodyHtml, preheader: subject }), text };
}
