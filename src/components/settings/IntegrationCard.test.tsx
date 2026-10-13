// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/lib/actions/integration", () => ({ removeIntegration: vi.fn(), testIntegration: vi.fn(), saveIntegration: vi.fn() }));

import { IntegrationCards } from "./IntegrationCard";
import { summarize, toItemView } from "@/lib/integrations/view";

const row = (managedByPlatform: boolean, integration: "evolution" | "n8n" = "evolution") => ({
  id: "i1", integration, name: "default", hint: "wxyz", baseUrl: "https://evo.exemplo.test/x?token=abc", allowPrivateHost: false, updatedAt: new Date(),
  lastTestedAt: new Date("2026-10-01T10:00:00Z"), lastTestOk: false, lastTestError: "ECONNREFUSED evo.interno:8080", managedByPlatform,
});

describe("IntegrationCards (SPEC-069e): chave da plataforma no tenant", () => {
  it("platform: sem 'Testar conexao', sem erro de teste, sem URL; chave propria mantem o botao e o erro", () => {
    const plat = summarize("evolution", [toItemView(row(true))], false);
    const html = renderToStaticMarkup(<IntegrationCards summaries={[plat]} features={{}} />);
    expect(html).toContain("Gerenciada pela plataforma");
    expect(html).not.toContain("Testar conexão");
    expect(html).not.toContain("ECONNREFUSED");
    expect(html).not.toContain("Testada em");
    expect(html).not.toContain("token=abc");
    const own = summarize("n8n", [toItemView(row(false, "n8n"))], false);
    const html2 = renderToStaticMarkup(<IntegrationCards summaries={[own]} features={{ "ingest.api": true }} />);
    expect(html2).toContain("Testar conexão");
    expect(html2).toContain("ECONNREFUSED");
  });
});
