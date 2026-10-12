// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { AccountStage } from "./account-stage";
import { resolveStageRoute } from "./account-stage";
import { STAGE_RULES, firstParam, stageGuardTarget, type StageRoute } from "./stage-guard";

const STAGES: AccountStage[] = ["sem_plano", "aguardando_pagamento", "pago_sem_org", "membro", "dono", "membro_pago_sem_org", "admin"];
/** Destinos que ficam FORA das telas de onboarding (renderizam no app/admin e nao redirecionam de volta). */
const TERMINAL = new Set(["/dashboard", "/admin/organizacoes", "/configuracoes/conta"]);

function ruleFor(path: string): (typeof STAGE_RULES)[StageRoute] | undefined {
  return (STAGE_RULES as Record<string, (typeof STAGE_RULES)[StageRoute]>)[path];
}

describe("stageGuardTarget (SPEC-062b)", () => {
  it("estado permitido: sem redirect", () => {
    expect(stageGuardTarget("sem_plano", STAGE_RULES["/assinar"].allowed)).toBeNull();
  });
  it("nao permitido: vai ao destino do estado (resolveStageRoute) ou ao override", () => {
    expect(stageGuardTarget("pago_sem_org", STAGE_RULES["/assinar"].allowed)).toBe("/organizacao/nova");
    expect(stageGuardTarget("dono", STAGE_RULES["/assinar"].allowed)).toBe("/dashboard");
    expect(stageGuardTarget("admin", STAGE_RULES["/assinar"].allowed)).toBe("/admin/organizacoes");
    expect(stageGuardTarget("dono", STAGE_RULES["/minha-conta"].allowed, STAGE_RULES["/minha-conta"].overrides)).toBe("/configuracoes/conta");
  });
  it("2a organizacao: ?nova=1 libera dono/membro; pago sem org nunca abre 2o checkout", () => {
    for (const s of ["dono", "membro"] as const) expect(stageGuardTarget(s, STAGE_RULES["/assinar?nova=1"].allowed)).toBeNull();
    for (const s of ["pago_sem_org", "membro_pago_sem_org"] as const) {
      for (const r of ["/assinar?nova=1", "/assinar"] as const) expect(stageGuardTarget(s, STAGE_RULES[r].allowed, STAGE_RULES[r].overrides)).toBe("/organizacao/nova");
    }
  });
  it("organizacao so abre com plano pago", () => {
    for (const s of ["sem_plano", "aguardando_pagamento"] as const) expect(stageGuardTarget(s, STAGE_RULES["/organizacao/nova"].allowed)).not.toBeNull();
    expect(stageGuardTarget("pago_sem_org", STAGE_RULES["/organizacao/nova"].allowed)).toBeNull();
  });
});

describe("sem laco de redirect (tabela rota x estado)", () => {
  for (const route of Object.keys(STAGE_RULES) as StageRoute[]) {
    for (const stage of STAGES) {
      it(`${route} com ${stage} termina em no maximo 1 salto numa tela que renderiza`, () => {
        const rule = STAGE_RULES[route];
        const target = stageGuardTarget(stage, rule.allowed, rule.overrides);
        if (target === null) return;
        if (TERMINAL.has(target)) return;
        const next = ruleFor(target);
        expect(next, `destino ${target} deve ser uma tela conhecida`).toBeDefined();
        expect(stageGuardTarget(stage, next!.allowed, next!.overrides), `${stage}: ${route} -> ${target} nao pode redirecionar de novo`).toBeNull();
      });
    }
  }
  it("o destino padrao de cada estado renderiza para o proprio estado", () => {
    for (const stage of STAGES) {
      const dest = resolveStageRoute(stage);
      if (TERMINAL.has(dest)) continue;
      const rule = ruleFor(dest);
      expect(rule, dest).toBeDefined();
      expect(stageGuardTarget(stage, rule!.allowed, rule!.overrides)).toBeNull();
    }
  });
});

describe("firstParam", () => {
  it("string, array e undefined", () => {
    expect(firstParam("a")).toBe("a");
    expect(firstParam(["b", "c"])).toBe("b");
    expect(firstParam(undefined)).toBeUndefined();
  });
});
