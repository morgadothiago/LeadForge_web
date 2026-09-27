// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/admin/organizations", () => ({ suspendOrganization: vi.fn(), reactivateOrganization: vi.fn() }));

import { OrganizationStatusActions } from "./OrganizationStatusActions";

/**
 * SPEC-032 — `Dialog` (base-ui) não renderiza nada no servidor enquanto `open=false` (confirmado:
 * `renderToStaticMarkup` de um `<Dialog open={false}>` retorna string vazia), então só a
 * escolha do botão correto por `status` é verificável estaticamente aqui; a interação (abrir o
 * diálogo, digitar o motivo, habilitar "Suspender") depende de DOM real e é coberta pelas mesmas
 * actions já testadas em `lib/actions/admin/organizations.test.ts` (SPEC-031) + revisão visual manual.
 */
describe("OrganizationStatusActions (SPEC-032)", () => {
  it("org ativa: mostra 'Suspender organização' (destrutivo), não mostra 'Reativar'", () => {
    const html = renderToStaticMarkup(<OrganizationStatusActions orgId="org-1" orgName="Acme" status="active" />);
    expect(html).toContain("Suspender organização");
    expect(html).not.toContain("Reativar organização");
  });

  it("org suspensa: mostra 'Reativar organização', não mostra 'Suspender'", () => {
    const html = renderToStaticMarkup(<OrganizationStatusActions orgId="org-1" orgName="Acme" status="suspended" />);
    expect(html).toContain("Reativar organização");
    expect(html).not.toContain("Suspender organização");
  });

  it("org cancelada: também mostra 'Reativar organização' (mesma ação de suspenso)", () => {
    const html = renderToStaticMarkup(<OrganizationStatusActions orgId="org-1" orgName="Acme" status="cancelled" />);
    expect(html).toContain("Reativar organização");
    expect(html).not.toContain("Suspender organização");
  });
});
