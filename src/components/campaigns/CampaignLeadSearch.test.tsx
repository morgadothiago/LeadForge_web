// @vitest-environment node
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/lib/actions/lead-search", () => ({ searchLeads: vi.fn(), getSearchRunStatus: vi.fn() }));

import { CampaignLeadSearch } from "./CampaignLeadSearch";
import { DISABLED_TEXT, confirmCostText, deriveBlock, estimateText, resultText, type ManagePanel } from "./lead-search-format";
import type { LeadSearchPanel } from "@/lib/queries/lead-search";

const base: ManagePanel = {
  canManage: true, role: "owner", enabled: true, hasKey: true, budget: 3, maxResults: 20, usedToday: 0,
  manualBudget: 2, orgBudget: 10, remainingManual: 2, remainingOrg: 9, estimatedPaidCallsLeft: 2, activeRun: null, hasNextPage: false, runs: [],
};
const render = (p: Partial<ManagePanel> | LeadSearchPanel, active = true) =>
  renderToStaticMarkup(<CampaignLeadSearch campaignId="c1" campaignName="Camp" campaignActive={active} panel={{ ...base, ...p } as LeadSearchPanel} />);
const btn = (html: string) => html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*Buscar agora<\/button>/)?.[0] ?? "";

describe("CampaignLeadSearch", () => {
  it("SPEC-060: com proxima pagina o botao vira Buscar mais resultados", () => {
    const html = render({ hasNextPage: true });
    expect(html).toContain("Buscar mais resultados");
    expect(render({})).not.toContain("Buscar mais resultados");
  });
  it("liberado: botão Buscar agora habilitado, estimativa e aviso de duplicados", () => {
    const html = render({});
    expect(btn(html)).not.toContain('disabled=""');
    expect(html).toContain("Restam 2 buscas manuais hoje (9 chamadas pagas na conta)");
    expect(html).toContain("Places Text Search");
    expect(html).toContain("não exibimos valor em R$");
    expect(html).toContain("duplicados");
    expect(html).not.toContain("Buscar leads?");
  });
  it("desligada no servidor: texto de suporte sem env var, botão desabilitado", () => {
    const html = render({ enabled: false });
    expect(html).toContain("Busca de leads indisponível no momento, fale com o suporte.");
    expect(html).not.toContain("LEAD_SEARCH");
    expect(btn(html)).toContain('disabled=""');
  });
  it("sem chave: link para integrações", () => {
    const html = render({ hasKey: false });
    expect(html).toContain('href="/configuracoes/integracoes"');
    expect(btn(html)).toContain('disabled=""');
  });
  it("member: botão desabilitado, explicação e histórico visível", () => {
    const html = render({ role: "member", runs: [{ id: "r1", trigger: "manual", status: "done", requests: 1, found: 5, created: 3, duplicate: 1, suppressed: 1, invalid: 0, error: null, startedAt: new Date("2026-10-10T12:00:00Z") }] });
    expect(btn(html)).toContain('disabled=""');
    expect(html).toContain("Apenas o proprietário");
    expect(html).toContain("3 novos");
  });
  it("campanha não ativa", () => {
    const html = render({}, false);
    expect(html).toContain("A campanha precisa estar ativa");
    expect(btn(html)).toContain('disabled=""');
  });
  it("orçamento esgotado diz qual limite", () => {
    expect(render({ remainingManual: 0 })).toContain("buscas manuais desta campanha");
    expect(render({ remainingOrg: 0 })).toContain("da organização atingido");
  });
  it("activeRun inicia em estado rodando (sobrevive a refresh)", () => {
    const html = render({ activeRun: { id: "r9", trigger: "manual", startedAt: new Date() } });
    expect(html).toContain("Buscando leads");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(btn(html)).toContain('disabled=""');
  });
  it("histórico: trigger, status, contadores e erro", () => {
    const html = render({ runs: [
      { id: "a", trigger: "scheduled", status: "failed", requests: 1, found: 0, created: 0, duplicate: 0, suppressed: 0, invalid: 0, error: "Quota excedida", startedAt: new Date() },
      { id: "b", trigger: "manual", status: "done", requests: 1, found: 8, created: 4, duplicate: 2, suppressed: 1, invalid: 1, error: null, startedAt: new Date() },
    ] });
    expect(html).toContain("Agendada");
    expect(html).toContain("Falhou");
    expect(html).toContain("Quota excedida");
    expect(html).toContain("Manual");
    expect(html).toContain("4 novos, 2 duplicados, 1 suprimido (1 inválido)");
  });
  it("sem canManage mostra só aviso", () => {
    expect(render({ canManage: false } as LeadSearchPanel)).toContain("Somente administradores");
  });
});

describe("lead-search-format", () => {
  it("prioridade dos bloqueios e textos", () => {
    expect(deriveBlock({ ...base, enabled: false, hasKey: false }, false)?.message).toBe(DISABLED_TEXT);
    expect(deriveBlock(base, true)).toBeNull();
    expect(deriveBlock({ ...base, remainingManual: 0, remainingOrg: 0 }, true)?.message).toContain("desta campanha");
  });
  it("custo no diálogo e singular", () => {
    expect(confirmCostText(base)).toBe("Esta busca usa 1 chamada paga; restam 2 hoje.");
    expect(confirmCostText({ ...base, estimatedPaidCallsLeft: 1 })).toContain("resta 1 hoje");
    expect(estimateText({ ...base, remainingManual: 1, remainingOrg: 1 })).toContain("Resta 1 busca manual hoje (1 chamada paga na conta)");
  });
  it("resultado concluído", () => {
    expect(resultText({ created: 1, duplicate: 2, suppressed: 0, invalid: 3 })).toBe("1 novo, 2 duplicados, 0 suprimidos (3 inválidos)");
  });
});
