import { afterEach, describe, expect, it } from "vitest";
import { FEATURE_KEYS, PLAN_MATRIX } from "./plan-catalog";
import { COMPARISON_GROUPS, comparisonCell, formatLimitValue, lockedFeatureText, planComparison } from "./plan-ui";

describe("plan-ui (SPEC-069d): comparativo gerado do catalogo", () => {
  it("cobre toda funcionalidade vendida e todo limite do catalogo (llm.byok fica de fora de proposito)", () => {
    const rows = COMPARISON_GROUPS.flatMap((g) => g.rows);
    const features = new Set(rows.flatMap((r) => (r.kind === "feature" ? [r.feature] : [])));
    // Os modos draft/sample de autonomia entram no comparativo como "modo automatico" + papeis; nenhuma feature vendida pode faltar a nao ser estas:
    const allowedMissing = new Set(["llm.byok", "agents.autonomy.draft", "agents.autonomy.sample", "inbox.read"]);
    expect(FEATURE_KEYS.filter((k) => !features.has(k) && !allowedMissing.has(k))).toEqual([]);
    const limits = new Set(rows.flatMap((r) => (r.kind === "limit" ? [r.limit] : [])));
    for (const k of Object.keys(PLAN_MATRIX.pro.limits)) expect(limits.has(k as never), `limite ${k} sem linha no comparativo`).toBe(true);
  });

  it("celulas refletem a matriz: Free sem agentes, Starter so follow-up, Pro tudo, Business ilimitado", () => {
    const row = (label: string) => planComparison(["free", "starter", "pro", "business"]).groups.flatMap((g) => g.rows).find((r) => r.label === label)!;
    expect(row("Agente de follow-up").cells.map((c) => c.kind)).toEqual(["no", "yes", "yes", "yes"]);
    expect(row("Agente SDR (primeiro contato)").cells.map((c) => c.kind)).toEqual(["no", "no", "yes", "yes"]);
    expect(row("Agentes ativos ao mesmo tempo").cells.map((c) => c.text)).toEqual(["Não inclui", "1", "3", "Ilimitado"]);
    expect(row("Teto de custo de IA").cells.map((c) => c.text.replace(/\u00a0/g, " "))).toEqual(["Não inclui", "R$ 50,00 por mês", "R$ 200,00 por mês", "Ilimitado"]);
    expect(row("Criativos de vídeo").cells.map((c) => c.text)).toEqual(["Não inclui", "3 por mês", "20 por mês", "Ilimitado"]);
    expect(row("Passos por sequência").cells.map((c) => c.text)).toEqual(["3", "5", "Ilimitado", "Ilimitado"]);
    expect(row("Google Ads e Meta Lead Ads").cells.map((c) => c.kind)).toEqual(["no", "no", "yes", "yes"]);
  });

  describe("AC-5: mudar o catalogo muda o comparativo sem tocar o codigo de checagem", () => {
    const orig = { members: PLAN_MATRIX.starter.limits.maxMembers, ads: PLAN_MATRIX.starter.features["sources.ads"] };
    afterEach(() => {
      PLAN_MATRIX.starter.limits.maxMembers = orig.members;
      PLAN_MATRIX.starter.features["sources.ads"] = orig.ads;
    });
    it("valor numerico e feature", () => {
      PLAN_MATRIX.starter.limits.maxMembers = 7;
      PLAN_MATRIX.starter.features["sources.ads"] = true;
      const cmp = planComparison(["starter"]);
      const rows = cmp.groups.flatMap((g) => g.rows);
      expect(rows.find((r) => r.label === "Membros da equipe")!.cells[0].text).toBe("7");
      expect(rows.find((r) => r.label === "Google Ads e Meta Lead Ads")!.cells[0].kind).toBe("yes");
    });
  });

  it("formatLimitValue e textos de bloqueio", () => {
    expect(formatLimitValue(null)).toEqual({ kind: "text", text: "Ilimitado" });
    expect(formatLimitValue(0).kind).toBe("no");
    expect(formatLimitValue(1000, "per_day").text).toBe("1.000 por dia");
    expect(comparisonCell("pro", { kind: "feature", feature: "inbox.attachments", label: "x" }).kind).toBe("yes");
    expect(lockedFeatureText("agents.role.closer")).toMatchObject({ requiredPlan: "Pro", text: "Disponível no plano Pro" });
    expect(lockedFeatureText("agents.role.followup").requiredPlan).toBe("Starter");
  });
});
