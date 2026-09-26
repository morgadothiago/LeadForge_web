import { describe, expect, it } from "vitest";
import { NAV_ITEMS, getPageTitle, isActivePath } from "./nav-items";

describe("nav-items", () => {
  it("mantém 9 itens na ordem e com rótulos PT-BR", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(["Dashboard", "Pipeline", "Calendário", "Leads", "Campanhas", "Sequences", "Aprovações", "Notificações", "Configurações"]);
  });
  it("rotas novas e bolinha: Pipeline/Dashboard/Campanhas/Sequences sem badgeKey", () => {
    expect(NAV_ITEMS).toHaveLength(9);
    expect(NAV_ITEMS.find((i) => i.href === "/calendario")?.badgeKey).toBe("calendario");
    expect(NAV_ITEMS.find((i) => i.href === "/notificacoes")?.badgeKey).toBe("notificacoes");
    expect(NAV_ITEMS.filter((i) => i.badgeKey).map((i) => i.href)).toEqual(["/calendario", "/leads", "/aprovacoes", "/notificacoes", "/configuracoes"]);
    expect(new Set(NAV_ITEMS.map((i) => i.href)).size).toBe(9);
  });
  it("isActivePath: exato, prefixo e falso-positivo", () => {
    expect(isActivePath("/leads", "/leads")).toBe(true);
    expect(isActivePath("/leads/123", "/leads")).toBe(true);
    expect(isActivePath("/leadsx", "/leads")).toBe(false);
    expect(isActivePath("/", "/leads")).toBe(false);
  });
  it("getPageTitle: rota conhecida, subrota e desconhecida", () => {
    expect(getPageTitle("/pipeline")).toBe("Pipeline");
    expect(getPageTitle("/leads/123")).toBe("Leads");
    expect(getPageTitle("/nada")).toBe("LeadForge");
  });
});
