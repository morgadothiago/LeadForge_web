// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/admin/entitlements", () => ({
  setOrgEntitlementOverride: vi.fn(), clearOrgEntitlementOverride: vi.fn(), setOrgAgentSettingsByAdmin: vi.fn(), setAgentPolicyByAdmin: vi.fn(), saveOrgIntegrationByAdmin: vi.fn(), removeOrgIntegrationByAdmin: vi.fn(),
}));

import { AgentsPolicyTab } from "./AgentsPolicyTab";
import { AuditTab } from "./AuditTab";
import { IntegrationsPolicyTab } from "./IntegrationsPolicyTab";
import { OrgPolicyPanel } from "./OrgPolicyPanel";
import { PlanOverrideTab } from "./PlanOverrideTab";
import type { OrgPolicyView } from "@/lib/queries/admin/org-policy";

const policy: OrgPolicyView = {
  org: { id: "o1", name: "Acme", status: "active" },
  plan: { key: "starter", name: "Starter", subscriptionStatus: "active" },
  effective: { features: { "agents.role.sdr": false, "llm.byok": true } as never, limits: { maxAiBudgetCentsMonth: 5000, maxAgentMessagesPerDay: 20, maxMembers: null } as never, source: "plan", paused: false, overrideActive: true, overrideExpiresAt: "2030-01-31T23:59:59.999Z" },
  override: { features: { "llm.byok": true }, limits: {}, reason: "cliente piloto", expiresAt: "2030-01-31T23:59:59.999Z", createdBy: "adm", updatedAt: "2026-10-13T10:00:00.000Z" },
  agentSettings: { killSwitch: false, lockedByAdmin: true, monthlyBudgetCents: 10000 },
  agents: [{ id: "a1", role: "followup", active: true, autonomy: "draft", model: "claude-haiku-4-5", monthlyBudgetCents: 3000, dailyMessageLimit: 20, maxTurnsPerLead: 5 }],
  integrations: [{ id: "i1", integration: "evolution", name: "default", hint: "ab12", hostMasked: "ev***.example.com", allowPrivateHost: false, managedByPlatform: true, lastTestOk: true, updatedAt: "2026-10-13T10:00:00.000Z" }],
  platformLlmConfigured: false,
  catalog: { features: [{ key: "agents.role.sdr", label: "Agente SDR" }, { key: "llm.byok", label: "Provedor de IA próprio (BYOK)" }], limits: [{ key: "maxMembers", label: "Membros da equipe" }] },
  audit: [{ id: "x1", adminUserId: "12345678-aaaa", action: "integration_key_set", reason: "gravar chave", at: "2026-10-13T10:00:00.000Z", meta: { area: "integration", fields: ["evolution", "create"] } }],
};

describe("OrgPolicyPanel (SPEC-069c)", () => {
  it("renderiza as 4 abas e a aba inicial de agentes", () => {
    const html = renderToStaticMarkup(<OrgPolicyPanel policy={policy} />);
    for (const t of ["Agentes e IA", "Integrações", "Plano e features", "Auditoria"]) expect(html).toContain(t);
    expect(html).toContain("Kill switch");
  });

  it("agentes: trava, teto em reais e política do agente", () => {
    const html = renderToStaticMarkup(<AgentsPolicyTab policy={policy} />);
    expect(html).toContain("Travar o kill switch");
    expect(html).toContain('value="100,00"');
    expect(html).toContain("claude-haiku-4-5");
    expect(html).toContain("Motivo da alteração");
  });

  it("integrações: mostra hint e host mascarado, nunca valor; campo de chave só no diálogo", () => {
    const html = renderToStaticMarkup(<IntegrationsPolicyTab policy={policy} />);
    expect(html).toContain("ab12");
    expect(html).toContain("ev***.example.com");
    expect(html).toContain("Chave da plataforma");
    expect(html).toContain("Não configurada");
    expect(html).not.toContain('type="password"');
  });

  it("plano: efetivo, override ativo com validade e motivo; selects com valor atual", () => {
    const html = renderToStaticMarkup(<PlanOverrideTab policy={policy} />);
    expect(html).toContain("Starter");
    expect(html).toContain("cliente piloto");
    expect(html).toContain("Remover override");
    expect(html).toContain("Ilimitado");
    expect(html).toContain('value="2030-01-31"');
  });

  it("auditoria: lista com rótulo PT-BR e campos; vazia mostra aviso", () => {
    expect(renderToStaticMarkup(<AuditTab audit={policy.audit} />)).toContain("Chave de integração gravada");
    expect(renderToStaticMarkup(<AuditTab audit={[]} />)).toContain("Nenhuma alteração registrada");
  });

  it("B1 (QA 069c): a view do admin traz allowPrivateHost; checkbox inicia no valor gravado e envia false explícito", async () => {
    const { initialAllowPrivateHost, allowPrivatePayload } = await import("./policy-format");
    expect(policy.integrations[0].allowPrivateHost).toBe(false);
    expect(initialAllowPrivateHost({ allowPrivateHost: true })).toBe(true);
    expect(initialAllowPrivateHost({ allowPrivateHost: false })).toBe(false);
    expect(initialAllowPrivateHost(undefined)).toBe(false);
    expect(allowPrivatePayload(true, false)).toEqual({ allowPrivateHost: false }); // desligar: false EXPLICITO (antes virava undefined e nao desligava)
    expect(allowPrivatePayload(true, true)).toEqual({ allowPrivateHost: true });
    expect(allowPrivatePayload(false, true)).toEqual({}); // integracao sem URL (Places): nada
  });

  it("B2 (QA 069c): erro por campo features.<chave> aparece sob a funcionalidade (role=alert, aria-invalid); sem erro nada aparece", async () => {
    const { FeatureOverrideRow } = await import("./PlanOverrideTab");
    const withErr = renderToStaticMarkup(<FeatureOverrideRow id="f1" label="Agente SDR" effectiveOn={false} value="on" error="Funcionalidade desconhecida: x." onChange={() => {}} />);
    expect(withErr).toContain('role="alert"');
    expect(withErr).toContain("Funcionalidade desconhecida: x.");
    expect(withErr).toContain('aria-invalid="true"');
    const ok = renderToStaticMarkup(<FeatureOverrideRow id="f1" label="Agente SDR" effectiveOn={false} value="plan" onChange={() => {}} />);
    expect(ok).not.toContain('role="alert"');
    expect(renderToStaticMarkup(<PlanOverrideTab policy={policy} />)).toContain("Remover override");
  });
});
