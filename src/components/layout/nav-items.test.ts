import { describe, expect, it } from "vitest";
import { ADMIN_NAV_ITEMS, NAV_ITEMS, NAV_SECTIONS, aggregateFresh, flattenItems, flattenSections, hasActiveChild, getPageTitle, isActivePath, type NavItem } from "./nav-items";

describe("nav-items", () => {
  it("mantém 11 itens na ordem e com rótulos PT-BR", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(["Dashboard", "Atendimento", "Leads", "Pipeline", "Campanhas", "Sequences", "Calendário", "Criativos", "Aprovações", "Notificações", "Configurações"]);
  });
  it("rotas novas e bolinha: Pipeline/Dashboard/Campanhas/Sequences sem badgeKey", () => {
    expect(NAV_ITEMS).toHaveLength(11);
    expect(NAV_ITEMS.find((i) => i.href === "/calendario")?.badgeKey).toBe("calendario");
    expect(NAV_ITEMS.find((i) => i.href === "/notificacoes")?.badgeKey).toBe("notificacoes");
    expect(NAV_ITEMS.filter((i) => i.badgeKey).map((i) => i.href)).toEqual(["/leads", "/calendario", "/aprovacoes", "/notificacoes", "/configuracoes"]);
    expect(new Set(NAV_ITEMS.map((i) => i.href)).size).toBe(11);
  });
  it("SPEC-068b: Atendimento aponta para /atendimento, tem inboxBadge e nao usa o badgeKey das notificacoes", () => {
    const a = NAV_ITEMS.find((i) => i.href === "/atendimento");
    expect(a).toMatchObject({ label: "Atendimento", inboxBadge: true });
    expect(a?.badgeKey).toBeUndefined();
    expect(getPageTitle("/atendimento")).toBe("Atendimento");
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

  it("SPEC-032: ADMIN_NAV_ITEMS tem só 'Administração', sem sobrepor NAV_ITEMS", () => {
    expect(ADMIN_NAV_ITEMS).toHaveLength(1);
    expect(ADMIN_NAV_ITEMS[0]).toMatchObject({ href: "/admin/organizacoes", label: "Administração" });
    expect(NAV_ITEMS.some((i) => i.href === "/admin/organizacoes")).toBe(false);
  });

  it("getPageTitle reconhece rotas de administração (lista e detalhe)", () => {
    expect(getPageTitle("/admin/organizacoes")).toBe("Administração");
    expect(getPageTitle("/admin/organizacoes/abc-123")).toBe("Administração");
  });

  describe("SPEC-057: NAV_SECTIONS", () => {
    it("seções na ordem, com títulos e itens da SPEC", () => {
      expect(NAV_SECTIONS.map((s) => s.title)).toEqual([undefined, "Captação de leads", "Criativos", "Automação", "Conta"]);
      expect(NAV_SECTIONS.map((s) => s.items.map((i) => i.label))).toEqual([
        ["Dashboard", "Atendimento"],
        ["Leads", "Pipeline", "Campanhas", "Sequences", "Calendário"],
        ["Criativos"],
        ["Aprovações"],
        ["Notificações", "Configurações"],
      ]);
    });
    it("NAV_ITEMS é o flatten das seções; Criativos tem tag new e nenhum subitem inventado", () => {
      expect(NAV_ITEMS).toEqual(flattenSections(NAV_SECTIONS));
      expect(NAV_ITEMS.find((i) => i.href === "/criativos")).toMatchObject({ tag: "new" });
      expect(NAV_ITEMS.some((i) => i.children)).toBe(false);
    });
    it("ADMIN_NAV_ITEMS nunca entra em NAV_SECTIONS", () => {
      expect(flattenSections(NAV_SECTIONS).some((i) => i.href.startsWith("/admin"))).toBe(false);
    });
    const parent: NavItem = {
      ...NAV_ITEMS[0],
      href: "/p",
      badgeKey: undefined,
      children: [
        { ...NAV_ITEMS[0], href: "/p/a", badgeKey: "leads" },
        { ...NAV_ITEMS[0], href: "/p/b", badgeKey: "calendario" },
      ],
    };
    it("flatten inclui filhos; filho ativo abre o pai", () => {
      expect(flattenItems([parent]).map((i) => i.href)).toEqual(["/p", "/p/a", "/p/b"]);
      expect(hasActiveChild("/p/b/1", parent)).toBe(true);
      expect(hasActiveChild("/outra", parent)).toBe(false);
      expect(getPageTitle("/leads")).toBe("Leads");
    });
    it("bolinha agregada soma os filhos", () => {
      const counts: Record<string, number> = { leads: 2, calendario: 1 };
      expect(aggregateFresh(parent, (k) => counts[k] ?? 0)).toBe(3);
      expect(aggregateFresh(parent, () => 0)).toBe(0);
    });
  });
});
