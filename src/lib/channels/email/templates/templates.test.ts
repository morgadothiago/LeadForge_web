import { describe, expect, it } from "vitest";
import { passwordResetTemplate } from "./password-reset";
import { courtesyWelcomeTemplate } from "./courtesy-welcome";
import { billingReminderTemplate } from "./billing-reminder";
import { subscriptionSuccessTemplate } from "./subscription-success";
import { subscriptionCanceledTemplate } from "./subscription-canceled";

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
      status: "active",
      nextBillingDate,
    });
    expect(subject).toMatch(/[Aa]ssinatura/);
    expect(html).toContain("Starter");
    expect(html).toContain("R$"); // Intl.NumberFormat BRL.
    expect(text).toContain("Starter");
    expect(text).toContain("297,00");
  });

  it("status trialing: sem cobrança ainda, mensagem de início de teste", () => {
    const { subject, text } = subscriptionSuccessTemplate({ planName: "Pro", amountCents: null, status: "trialing", nextBillingDate: null });
    expect(subject).toMatch(/teste/i);
    expect(text).not.toMatch(/R\$/);
  });

  it("escapa nome de plano com caracteres especiais (defesa em profundidade)", () => {
    const { html } = subscriptionSuccessTemplate({ planName: '<script>alert(1)</script>', amountCents: 100, status: "active", nextBillingDate: null });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("subscriptionCanceledTemplate (NOVO, SPEC-046)", () => {
  it("inclui data de acesso e data de expurgo (90 dias, D-33-4)", () => {
    const accessUntil = new Date("2026-03-15T00:00:00Z");
    const purgeDate = new Date("2026-06-01T00:00:00Z");
    const { subject, html, text } = subscriptionCanceledTemplate({ planName: "Starter", accessUntil, purgeDate });
    expect(subject).toMatch(/cancelad/i);
    expect(html).toContain("15 de março de 2026");
    expect(html).toContain("01 de junho de 2026");
    expect(text).toContain("15 de março de 2026");
    expect(text).toContain("01 de junho de 2026");
  });

  it("accessUntil null: mensagem de encerramento imediato", () => {
    const { text } = subscriptionCanceledTemplate({ planName: "Starter", accessUntil: null, purgeDate: new Date("2026-06-01T00:00:00Z") });
    expect(text).toMatch(/encerrado imediatamente/i);
  });
});
