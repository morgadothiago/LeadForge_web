import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-page", () => ({ redirectIfTrialExpired: vi.fn(async () => undefined) }));

import Page from "./page";

/** SPEC-069f: a rota de Integracoes do cliente nao existe mais (integracoes sao do platform_admin). */
describe("/configuracoes/integracoes", () => {
  it("responde 404 (notFound) para o cliente", async () => {
    let digest = "";
    try {
      await Page();
    } catch (e) {
      digest = String((e as { digest?: string }).digest ?? "");
    }
    expect(digest).toContain("404");
  });
});
