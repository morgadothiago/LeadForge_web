// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/admin/organizations", () => ({ createCourtesyOrganization: vi.fn() }));

import { CreateCourtesyOrgDialog } from "./CreateCourtesyOrgDialog";

/**
 * SPEC-040 — mesma limitação de `OrganizationStatusActions.test.tsx` (SPEC-032): `Dialog` (base-ui) não
 * renderiza nada no servidor enquanto `open=false`, então só o botão-gatilho é verificável
 * estaticamente aqui. A submissão do formulário (`createCourtesyOrganization`) já é coberta por
 * `src/lib/actions/admin/organizations.test.ts` (SPEC-040, backend); a interação do dialog em si
 * (abrir, preencher campos, ver erro/toast) fica para revisão visual manual em navegador.
 */
describe("CreateCourtesyOrgDialog (SPEC-040)", () => {
  it("mostra o botão-gatilho 'Nova conta de cortesia', dialog fechado por padrão", () => {
    const html = renderToStaticMarkup(<CreateCourtesyOrgDialog />);
    expect(html).toContain("Nova conta de cortesia");
    expect(html).not.toContain("Criar conta de cortesia");
  });
});
