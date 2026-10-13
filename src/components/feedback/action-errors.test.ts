import { describe, expect, it } from "vitest";
import { actionErrorInfo } from "./action-errors";

describe("actionErrorInfo (SPEC-069d)", () => {
  it("plan_feature_locked por plano: mensagem do servidor + CTA Fazer upgrade", () => {
    const i = actionErrorInfo({ _form: ["Agente Closer: disponível no plano Pro. Faça upgrade para usar."], code: ["plan_feature_locked"], feature: ["agents.role.closer"], requiredPlan: ["Pro"], reason: ["plan"] });
    expect(i.code).toBe("plan_feature_locked");
    expect(i.message).toContain("plano Pro");
    expect(i.cta).toEqual({ label: "Fazer upgrade", href: "/configuracoes/assinatura" });
  });
  it("plan_feature_locked por pagamento/bloqueio: CTA Ver assinatura (upgrade nao resolve)", () => {
    for (const reason of ["past_due", "blocked"]) {
      const i = actionErrorInfo({ _form: ["Regularize."], code: ["plan_feature_locked"], reason: [reason] });
      expect(i.cta).toEqual({ label: "Ver assinatura", href: "/configuracoes/assinatura" });
    }
  });
  it("plan_feature_locked sem _form usa texto padrao PT-BR e nunca vaza chaves tecnicas", () => {
    const i = actionErrorInfo({ code: ["plan_feature_locked"], feature: ["agents.role.sdr"], requiredPlan: ["Pro"] });
    expect(i.message).toMatch(/não está incluído no seu plano/);
    expect(i.message).not.toMatch(/agents\.role|Pro$/);
  });
  it("policy_admin_only e policy_locked: texto amigavel, sem CTA de upgrade", () => {
    const a = actionErrorInfo({ _form: ["Definido pela plataforma: modelo de IA. Apenas o administrador da plataforma altera este valor; peça a ele ou fale com o suporte."], code: ["policy_admin_only"], fields: ["model"] });
    expect(a.code).toBe("policy_admin_only");
    expect(a.cta).toBeNull();
    expect(a.message).toMatch(/^Definido pela plataforma/);
    const b = actionErrorInfo({ code: ["policy_admin_only"] });
    expect(b.message).toMatch(/definido pela plataforma/i);
    const c = actionErrorInfo({ code: ["policy_locked"] });
    expect(c.code).toBe("policy_locked");
    expect(c.message).toMatch(/travado pela plataforma/);
    expect(c.cta).toBeNull();
  });
  it("mantem plan_limit, trial_expired e codigo desconhecido", () => {
    expect(actionErrorInfo({ _form: ["Limite."], code: ["plan_limit"], metric: ["agents"] }).cta?.label).toBe("Fazer upgrade");
    expect(actionErrorInfo({ code: ["trial_expired"] }).cta?.label).toBe("Ver assinatura");
    const u = actionErrorInfo({ _form: ["x"], code: ["algo_novo"] });
    expect(u.code).toBeNull();
    expect(u.cta).toBeNull();
  });
});
