import { describe, expect, it } from "vitest";
import {
  UPGRADE_HREF,
  daysWord,
  isAtLimit,
  limitReachedText,
  resolveUpgradeReturn,
  showsTrialChip,
  trialBannerText,
  trialChipText,
  usageRatio,
  usageText,
  usageTone,
} from "./trial-ui";
import { blockedPanelCopy } from "./trial-blocked-copy";
import { actionErrorInfo } from "@/components/feedback/action-errors";
import { maskDocument } from "@/lib/domain/document-mask";
import { parseDocument } from "@/lib/domain/document";
import { signupSchema } from "@/lib/schemas/billing";
import { isOnboardingDismissed, onboardingCookieName } from "@/lib/onboarding-state";

describe("chip e banner de dias (SPEC-065b, D-065-24)", () => {
  it("singular e plural", () => {
    expect(daysWord(1)).toBe("1 dia");
    expect(daysWord(12)).toBe("12 dias");
    expect(trialChipText(14)).toBe("Teste grátis: 14 dias");
    expect(trialChipText(1)).toBe("Teste grátis: 1 dia");
  });
  it("banner dos ultimos dias", () => {
    expect(trialBannerText(3)).toContain("Faltam 3 dias");
    expect(trialBannerText(2)).toContain("Faltam 2 dias");
    expect(trialBannerText(1)).toContain("termina hoje ou amanhã");
  });
  it("chip so no trial ativo/expirando", () => {
    expect(showsTrialChip("trial_ativo")).toBe(true);
    expect(showsTrialChip("trial_expirando")).toBe(true);
    for (const s of ["trial_expirado", "pago", "pago_em_atraso", "soft_blocked", "sem_assinatura", null, undefined] as const) expect(showsTrialChip(s)).toBe(false);
    expect(UPGRADE_HREF).toBe("/configuracoes/assinatura");
  });
});

describe("medidor de uso", () => {
  it("limite, razao, tom e texto", () => {
    expect(isAtLimit({ used: 1, limit: 1 })).toBe(true);
    expect(isAtLimit({ used: 0, limit: 1 })).toBe(false);
    expect(isAtLimit({ used: 99, limit: null })).toBe(false);
    expect(usageRatio({ used: 25, limit: 50 })).toBe(0.5);
    expect(usageRatio({ used: 80, limit: 50 })).toBe(1);
    expect(usageRatio({ used: 5, limit: null })).toBe(0);
    expect(usageRatio({ used: 0, limit: 0 })).toBe(1);
    expect(usageTone({ used: 10, limit: 50 })).toBe("ok");
    expect(usageTone({ used: 40, limit: 50 })).toBe("warn");
    expect(usageTone({ used: 50, limit: 50 })).toBe("full");
    expect(usageText({ used: 12, limit: 50 })).toBe("12 de 50");
    expect(usageText({ used: 12, limit: null })).toBe("12 (sem limite)");
  });
  it("mensagens de limite atingido (singular/plural)", () => {
    expect(limitReachedText("campaigns", 1)).toBe("Você já usa 1 de 1 campanha ativa do seu plano.");
    expect(limitReachedText("campaigns", 3)).toContain("3 de 3 campanhas ativas");
    expect(limitReachedText("whatsapp", 1)).toContain("1 de 1 número de WhatsApp");
    expect(limitReachedText("email_accounts", 2)).toContain("2 de 2 contas de e-mail");
    expect(limitReachedText("leads", 50)).toContain("50 de 50 leads");
    expect(limitReachedText("sends", 20)).toContain("20 de 20 envios de hoje");
  });
});

describe("retorno do checkout: a URL nunca libera (D-062-11/D-065-15)", () => {
  it("so success inicia; o pago vem do servidor", () => {
    expect(resolveUpgradeReturn(null, { paid: false, timedOut: false })).toBe("idle");
    expect(resolveUpgradeReturn("cancel", { paid: false, timedOut: false })).toBe("idle");
    expect(resolveUpgradeReturn("success", { paid: false, timedOut: false })).toBe("confirming");
    expect(resolveUpgradeReturn("success", { paid: false, timedOut: true })).toBe("timeout");
    expect(resolveUpgradeReturn("success", { paid: true, timedOut: true })).toBe("paid");
    // sem success na URL, mesmo pago, nada a mostrar
    expect(resolveUpgradeReturn(null, { paid: true, timedOut: false })).toBe("idle");
  });
});

describe("tela de bloqueio: dono x membro x ja usou o teste (D-065-14)", () => {
  it("dono: mensagem com a data e dados guardados", () => {
    const c = blockedPanelCopy({ isOwner: true, ownerName: "Ana", endedAtText: "10/10/2026", neverGranted: false });
    expect(c.title).toBe("Seu teste grátis terminou em 10/10/2026");
    expect(c.text).toContain("Seus dados estão guardados");
  });
  it("membro: pede ao proprietario e cita o nome, sem culpar", () => {
    const c = blockedPanelCopy({ isOwner: false, ownerName: "Ana", endedAtText: "10/10/2026", neverGranted: false });
    expect(c.title).toBe("O teste grátis desta organização terminou");
    expect(c.text).toContain("Peça ao proprietário (Ana)");
    expect(blockedPanelCopy({ isOwner: false, ownerName: null, endedAtText: null, neverGranted: false }).text).toContain("Peça ao proprietário para assinar");
  });
  it("trial que nasceu expirado: mensagem generica que nao diz qual dado bateu", () => {
    const c = blockedPanelCopy({ isOwner: true, ownerName: "Ana", endedAtText: "10/10/2026", neverGranted: true });
    expect(c.title).toBe("Não foi possível liberar o teste grátis para este cadastro");
    expect(c.text).not.toMatch(/CPF|CNPJ|e-mail já|cadastrad/i);
  });
});

describe("helper unico de mensagens de erro do backend (action-errors)", () => {
  it("plan_limit: mensagem do servidor + CTA de upgrade; chaves tecnicas nao entram", () => {
    const i = actionErrorInfo({ _form: ["Seu plano permite 1 campanha ativa."], code: ["plan_limit"], metric: ["campaigns"], limit: ["1"], used: ["1"] });
    expect(i).toEqual({ code: "plan_limit", message: "Seu plano permite 1 campanha ativa.", cta: { label: "Fazer upgrade", href: "/configuracoes/assinatura" } });
  });
  it("trial_expired: texto proprio e CTA para a assinatura", () => {
    const i = actionErrorInfo({ _form: ["Sem permissão."], code: ["trial_expired"] });
    expect(i.code).toBe("trial_expired");
    expect(i.message).toContain("teste grátis terminou");
    expect(i.cta?.href).toBe("/configuracoes/assinatura");
  });
  it("comuns: usa _form, depois o 1o campo, depois o fallback; nunca o codigo", () => {
    expect(actionErrorInfo({ _form: ["Erro geral."] }).message).toBe("Erro geral.");
    expect(actionErrorInfo({ email: ["E-mail inválido."] }).message).toBe("E-mail inválido.");
    expect(actionErrorInfo({ code: ["email_not_verified"] }, "Fallback.").message).toBe("Fallback.");
    expect(actionErrorInfo(undefined).message).toContain("Tente novamente");
    expect(actionErrorInfo({ _form: ["x"], code: ["email_not_verified"] }).cta).toBeNull();
    expect(actionErrorInfo({ _form: ["x"], code: ["qualquer"] }).code).toBeNull();
  });
});

describe("campo CPF/CNPJ do /signup (D-065-27.2)", () => {
  it("mascara progressiva de CPF e CNPJ; descarta excesso e nao-digitos", () => {
    expect(maskDocument("")).toBe("");
    expect(maskDocument("123")).toBe("123");
    expect(maskDocument("1234")).toBe("123.4");
    expect(maskDocument("12345678901")).toBe("123.456.789-01");
    expect(maskDocument("123.456.789-01")).toBe("123.456.789-01");
    expect(maskDocument("123456789012")).toBe("12.345.678/9012");
    expect(maskDocument("12345678000195")).toBe("12.345.678/0001-95");
    expect(maskDocument("1234567800019599999")).toBe("12.345.678/0001-95");
    expect(maskDocument("abc12.3")).toBe("123");
  });
  it("a mascara e idempotente e o valor mascarado valida (CPF/CNPJ reais de teste)", () => {
    for (const v of ["529.982.247-25", "11.222.333/0001-81"]) {
      expect(maskDocument(maskDocument(v))).toBe(v);
      expect(parseDocument(v)).not.toBeNull();
    }
  });
  const base = { name: "Ana", email: "a@x.com", password: "abc123", confirmPassword: "abc123" };
  it("signupSchema (cliente): documento invalido, sequencia repetida e vazio viram erro de campo PT-BR", () => {
    const err = (document: string) => {
      const r = signupSchema.safeParse({ ...base, document });
      return r.success ? null : r.error.issues.find((i) => i.path[0] === "document")?.message;
    };
    expect(err("")).toBe("CPF ou CNPJ é obrigatório.");
    expect(err("123.456.789-00")).toBe("CPF ou CNPJ inválido.");
    expect(err("111.111.111-11")).toBe("CPF ou CNPJ inválido.");
    expect(err("12.345.678/0001-00")).toBe("CPF ou CNPJ inválido.");
    expect(err("529.982.247-25")).toBeNull();
    expect(err("11.222.333/0001-81")).toBeNull();
  });
});

describe("dispensar cartoes do dashboard (cookie por organizacao)", () => {
  it("nome do cookie por cartao e org; so '1' dispensa", () => {
    expect(onboardingCookieName("name", "org-1")).toBe("lf_dismiss_name_org-1");
    expect(onboardingCookieName("steps", "org-1")).toBe("lf_dismiss_steps_org-1");
    expect(isOnboardingDismissed("1")).toBe(true);
    expect(isOnboardingDismissed(undefined)).toBe(false);
    expect(isOnboardingDismissed("0")).toBe(false);
  });
});
