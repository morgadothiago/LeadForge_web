import { describe, expect, it } from "vitest";
import { passwordResetTemplate } from "./password-reset";
import { courtesyWelcomeTemplate } from "./courtesy-welcome";
import { billingReminderTemplate } from "./billing-reminder";
import { subscriptionSuccessTemplate } from "./subscription-success";
import { subscriptionCanceledTemplate } from "./subscription-canceled";
import { cancelRequestedTemplate } from "./cancel-requested";
import { subscriptionReactivatedTemplate } from "./subscription-reactivated";
import { trialStartedTemplate } from "./trial-started";
import { paymentReceiptTemplate } from "./payment-receipt";
import { paymentFailedTemplate } from "./payment-failed";
import { paymentRecoveredTemplate } from "./payment-recovered";
import { renewalUpcomingTemplate } from "./renewal-upcoming";
import { planChangedTemplate } from "./plan-changed";

/**
 * SPEC-046 — cobre os 5 templates gerando `{subject, html, text}` a partir do mesmo dado. Verifica
 * conteúdo essencial (links/valores/datas) em AMBOS html e text, e que dado dinâmico é escapado no HTML
 * (defesa em profundidade contra injeção, mesmo quando a origem hoje é sempre interna/confiável).
 */
describe("passwordResetTemplate", () => {
  it("inclui o link no html e no text", () => {
    const link = "https://app.leadforge.local/redefinir-senha?token=abc123";
    const { subject, html, text } = passwordResetTemplate({ link });
    expect(subject).toMatch(/[Rr]edefini/);
    expect(html).toContain(link);
    expect(html).toContain("LeadForge");
    expect(text).toContain(link);
  });
});

describe("courtesyWelcomeTemplate", () => {
  it("inclui o link no html e no text", () => {
    const link = "https://app.leadforge.local/redefinir-senha?token=xyz789";
    const { subject, html, text } = courtesyWelcomeTemplate({ link });
    expect(subject).toMatch(/[Bb]em-vindo/);
    expect(html).toContain(link);
    expect(text).toContain(link);
  });
});

describe("billingReminderTemplate", () => {
  it("trial_ending: assunto e corpo compatíveis com a SPEC-039", () => {
    const { subject, html, text } = billingReminderTemplate("trial_ending");
    expect(subject).toMatch(/teste/i);
    expect(html).toContain("Configurações");
    expect(text).toMatch(/período de teste/i);
  });
  it("past_due_started", () => {
    const { subject, text } = billingReminderTemplate("past_due_started");
    expect(subject).toMatch(/pagamento/i);
    expect(text).toMatch(/7 dias/);
  });
  it("auto_suspended", () => {
    const { subject, text } = billingReminderTemplate("auto_suspended");
    expect(subject).toMatch(/suspensa/i);
    expect(text).toMatch(/suspensa/i);
  });
  it("purge_warning", () => {
    const { subject, text } = billingReminderTemplate("purge_warning");
    expect(subject).toMatch(/anonimizad/i);
    expect(text).toMatch(/90 dias/);
  });
});

describe("subscriptionSuccessTemplate (NOVO, SPEC-046)", () => {
  it("status active: inclui plano, valor e próxima cobrança", () => {
    const nextBillingDate = new Date("2026-04-01T00:00:00Z");
    const { subject, html, text } = subscriptionSuccessTemplate({
      planName: "Starter",
      amountCents: 29_700,
      nextBillingDate,
    });
    expect(subject).toMatch(/[Aa]ssinatura/);
    expect(html).toContain("Starter");
    expect(html).toContain("R$"); // Intl.NumberFormat BRL.
    expect(text).toContain("Starter");
    expect(text).toContain("297,00");
  });

  it("escapa nome de plano com caracteres especiais (defesa em profundidade)", () => {
    const { html } = subscriptionSuccessTemplate({ planName: '<script>alert(1)</script>', amountCents: 100, nextBillingDate: null });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("subscriptionCanceledTemplate (SPEC-046/053 — cancelamento efetivado)", () => {
  it("afirma acesso ENCERRADO na data, retencao de 90 dias e como reativar", () => {
    const accessEndedAt = new Date("2026-03-15T00:00:00Z");
    const purgeDate = new Date("2026-06-13T00:00:00Z");
    const { subject, html, text } = subscriptionCanceledTemplate({ planName: "Starter", accessEndedAt, purgeDate, link: "https://app.x.com/configuracoes/assinatura" });
    expect(subject).toMatch(/cancelad/i);
    expect(html).toContain("15 de março de 2026");
    expect(html).toContain("13 de junho de 2026");
    expect(text).toMatch(/acesso foi encerrado em 15 de março de 2026/);
    expect(text).not.toMatch(/continua dispon/i);
    expect(text).toContain("https://app.x.com/configuracoes/assinatura");
    expect(text).toMatch(/Reative/);
  });
});

describe("cancelRequestedTemplate (SPEC-053a #10)", () => {
  it("acesso ate a data, sem reembolso, retencao e como reverter; escapa HTML", () => {
    const { subject, html, text } = cancelRequestedTemplate({ planName: "<b>Pro</b>", accessUntil: new Date("2026-03-15T00:00:00Z"), purgeDate: new Date("2026-06-13T00:00:00Z"), link: "https://app.x.com/configuracoes/assinatura" });
    expect(subject).toMatch(/cancelamento/i);
    expect(text).toContain("acesso continua normal até 15 de março de 2026");
    expect(text).toContain("13 de junho de 2026");
    expect(text).toMatch(/reembolso/);
    expect(text).toContain("https://app.x.com/configuracoes/assinatura");
    expect(html).not.toContain("<b>Pro</b>");
  });
});

describe("subscriptionReactivatedTemplate (SPEC-053a #12)", () => {
  it("confirma manutencao e proxima cobranca", () => {
    const { subject, text } = subscriptionReactivatedTemplate({ planName: "Pro", nextBillingDate: new Date("2026-03-15T00:00:00Z"), link: "https://app.x.com/dashboard" });
    expect(subject).toMatch(/mantida/i);
    expect(text).toContain("15 de março de 2026");
  });
});

describe("trialStartedTemplate (SPEC-052a)", () => {
  it("assunto, data de fim do teste, link absoluto e escape", () => {
    const { subject, html, text } = trialStartedTemplate({ planName: "<b>Pro</b>", trialEndsAt: new Date("2026-03-15T00:00:00Z"), link: "https://app.x.com/dashboard" });
    expect(subject).toBe("Seu teste do plano <b>Pro</b> começou — LeadForge");
    expect(text).toContain("15 de março de 2026");
    expect(text).toContain("https://app.x.com/dashboard");
    expect(html).not.toContain("<b>Pro</b>");
    expect(html).toContain("https://app.x.com/dashboard");
  });
});

describe("paymentReceiptTemplate (SPEC-052a)", () => {
  const base = { planName: "Starter", amountCents: 29_700, paidAt: new Date("2026-03-01T00:00:00Z"), periodStart: new Date("2026-03-01T00:00:00Z"), periodEnd: new Date("2026-03-31T00:00:00Z"), link: "https://app.x.com/configuracoes/assinatura" };
  it("cartao: valor, data, final, periodo, pedido e rodape 'nao e nota fiscal'", () => {
    const { subject, html, text } = paymentReceiptTemplate({ ...base, paymentMethod: "card", cardLast4: "4242", orderId: "pay_1" });
    expect(subject).toMatch(/Recibo/);
    for (const part of ["297,00", "1 de março de 2026", "Cartão final 4242", "31 de março de 2026", "pay_1", "não é nota fiscal", base.link]) expect(text).toContain(part);
    expect(html).toContain("não é nota fiscal");
  });
  it("PIX sem pedido: omite a linha de pedido", () => {
    const { text } = paymentReceiptTemplate({ ...base, paymentMethod: "pix" });
    expect(text).toContain("PIX");
    expect(text).not.toContain("Nº do pedido");
  });
  it("nunca exibe numero de cartao alem de 4 digitos", () => {
    const { text, html } = paymentReceiptTemplate({ ...base, paymentMethod: "card", cardLast4: "4111111111111111" });
    expect(text).not.toContain("4111111111111111");
    expect(html).not.toContain("4111111111111111");
    expect(text).toContain("Cartão");
  });
});

describe("templates SPEC-052b", () => {
  const link = "https://app.x.com/configuracoes/assinatura";
  it("paymentFailed: assunto por passo, D+7 = ultimo aviso, link absoluto, so 4 digitos", () => {
    const base = { planName: "Starter", amountCents: 9900, suspendDate: new Date("2026-03-08T00:00:00Z"), link };
    expect(paymentFailedTemplate({ ...base, step: "d0" }).subject).toMatch(/processar seu pagamento/);
    expect(paymentFailedTemplate({ ...base, step: "d3" }).subject).toMatch(/Lembrete/);
    expect(paymentFailedTemplate({ ...base, step: "d5" }).subject).toMatch(/continua pendente/);
    const d7 = paymentFailedTemplate({ ...base, step: "d7", paymentMethod: "card", cardLast4: "4242" });
    expect(d7.subject).toMatch(/Último aviso/);
    for (const c of [d7.html, d7.text]) { expect(c).toContain(link); expect(c).toContain("99,00"); expect(c).toContain("final 4242"); }
    expect(paymentFailedTemplate({ ...base, step: "d0", paymentMethod: "card", cardLast4: "4111111111111111" }).text).not.toContain("4111111111111111");
    expect(paymentFailedTemplate({ ...base, step: "d0", amountCents: null }).text).not.toContain("Valor");
  });
  it("paymentRecovered / renewalUpcoming / planChanged: conteudo essencial e escape", () => {
    const r = paymentRecoveredTemplate({ planName: "<b>X</b>", nextBillingDate: new Date("2026-04-01T00:00:00Z"), link: "https://app.x.com/dashboard" });
    expect(r.html).not.toContain("<b>X</b>");
    expect(r.text).toContain("https://app.x.com/dashboard");
    const u = renewalUpcomingTemplate({ planName: "Pro", amountCents: 120000, renewalDate: new Date("2026-04-01T00:00:00Z"), cadence: "yearly", paymentMethod: "pix", link });
    expect(u.text).toContain("anual"); expect(u.text).toContain("PIX"); expect(u.html).toContain(link);
    const p = planChangedTemplate({ previousPlanName: "Starter", planName: "Pro", cadence: "monthly", amountCents: 19900, nextBillingDate: new Date("2026-04-01T00:00:00Z"), link });
    expect(p.subject).toContain("Pro"); expect(p.text).toContain("de Starter para Pro"); expect(p.html).toContain(link);
    expect(planChangedTemplate({ previousPlanName: null, planName: "Pro", cadence: "yearly", amountCents: null, nextBillingDate: null, link }).text).toContain("alterado para Pro");
  });
});

describe("orgMemberEventTemplate (SPEC-056)", () => {
  const base = { orgName: "Acme <b>", memberName: "Ana <i>", memberEmail: "ana@x.com", date: new Date("2026-10-10T12:00:00Z"), link: "https://app.leadforge.local/configuracoes/equipe" };
  it.each([["joined", /Novo membro/], ["left", /saiu/], ["removed", /removido/], ["role_changed", /Papel/]] as const)("%s: assunto, link e escape", async (kind, re) => {
    const { orgMemberEventTemplate } = await import("./org-member-event");
    const t = orgMemberEventTemplate({ ...base, kind, orgRole: "owner", fromRole: "member" });
    expect(t.subject).toMatch(re);
    expect(t.html).toContain(base.link);
    expect(t.text).toContain(base.link);
    expect(t.text).toContain("ana@x.com");
    expect(t.html).not.toContain("<b>");
    expect(t.html).not.toContain("<i>");
  });
});
