import { describe, expect, it } from "vitest";
import { resolveEntitlements, type EntitlementRow } from "@/lib/billing/entitlements";
import { planLimitsJson } from "@/lib/billing/plan-catalog";
import { toTenantView } from "@/lib/queries/entitlements";
import { activateBlock, anyRoleAllowed, toAgentPlanView } from "./agent-format";

const NOW = new Date("2026-10-13T12:00:00Z");
const ent = (key: "free" | "starter" | "pro", status: "active" | "past_due" = "active") => {
  const row: EntitlementRow = {
    status: "active",
    subscription: { status, pastDueSince: status === "past_due" ? new Date("2026-10-10T00:00:00Z") : null, cancelAtPeriodEnd: false, currentPeriodEnd: new Date("2026-11-13T00:00:00Z"), trialEndsAt: key === "free" ? new Date("2026-10-20T00:00:00Z") : null, plan: { key, limits: planLimitsJson(key) } },
    entitlementOverride: null,
  };
  return toTenantView(resolveEntitlements("o", row, NOW), true);
};
const agent = (over: Partial<Parameters<typeof activateBlock>[1]> = {}) => ({ role: "followup" as const, autonomy: "draft" as const, active: false, monthlyBudgetCents: 3000, ...over });

describe("agentes x plano (069d)", () => {
  it("Free: nenhum papel, nada de agentes", () => {
    const p = toAgentPlanView(ent("free"), 0);
    expect(anyRoleAllowed(p)).toBe(false);
    expect(activateBlock(p, agent())?.kind).toBe("role");
  });
  it("Starter: so follow-up em rascunho, 1 agente ativo", () => {
    const p = toAgentPlanView(ent("starter"), 0);
    expect(p.roles).toEqual({ sdr: false, followup: true, closer: false });
    expect(p.autonomy).toEqual({ draft: true, sampled: false, auto: false });
    expect(activateBlock(p, agent())).toBeNull();
    expect(activateBlock(p, agent({ role: "closer" }))?.text).toMatch(/disponível no plano Pro/);
    expect(activateBlock(p, agent({ autonomy: "auto" }))?.kind).toBe("autonomy");
    expect(activateBlock(toAgentPlanView(ent("starter"), 1), agent())?.kind).toBe("limit");
    expect(activateBlock(p, agent({ monthlyBudgetCents: null }))?.kind).toBe("budget");
    expect(activateBlock(toAgentPlanView(ent("starter"), 1), agent({ active: true }))).toBeNull(); // desligar nunca e bloqueado
  });
  it("Pro: tres papeis, ate 3 ativos, auto liberado", () => {
    const p = toAgentPlanView(ent("pro"), 2);
    expect(Object.values(p.roles).every(Boolean)).toBe(true);
    expect(p.autonomy.auto).toBe(true);
    expect(activateBlock(p, agent({ role: "closer", autonomy: "auto" }))).toBeNull();
    expect(activateBlock(toAgentPlanView(ent("pro"), 3), agent())?.kind).toBe("limit");
  });
  it("past_due: ativar bloqueado por pagamento (nao por upgrade)", () => {
    const p = toAgentPlanView(ent("pro", "past_due"), 0);
    expect(p.costlyBlocked).toBe(true);
    expect(p.lockReason).toBe("past_due");
    expect(activateBlock(p, agent())).toMatchObject({ kind: "billing" });
  });
});
