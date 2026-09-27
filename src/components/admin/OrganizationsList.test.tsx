// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OrgListItem } from "@/lib/queries/admin/organizations";
import { OrganizationsList } from "./OrganizationsList";

const item = (over: Partial<OrgListItem> = {}): OrgListItem => ({
  id: "11111111-2222-3333-4444-555555555555",
  name: "Acme Ltda",
  slug: "acme",
  status: "active",
  createdAt: new Date("2026-01-15T10:00:00.000Z"),
  ownerName: "Ana Souza",
  ownerEmail: "ana@acme.com",
  activeCampaigns: 2,
  totalLeads: 30,
  connectedWhatsapp: 1,
  ...over,
});

const render = (over: Partial<Parameters<typeof OrganizationsList>[0]> = {}) =>
  renderToStaticMarkup(<OrganizationsList items={[item()]} total={1} page={1} pageSize={20} totalPages={1} params={{}} {...over} />);

describe("OrganizationsList (SPEC-032)", () => {
  it("renderiza nome, slug, dono e contadores da organização", () => {
    const html = render();
    expect(html).toContain("Acme Ltda");
    expect(html).toContain("acme");
    expect(html).toContain("Ana Souza");
    expect(html).toContain("ana@acme.com");
    expect(html).toContain("2 campanhas ativas");
    expect(html).toContain("30 leads");
  });

  it("link da linha vai para /admin/organizacoes/:id", () => {
    expect(render()).toContain('href="/admin/organizacoes/11111111-2222-3333-4444-555555555555"');
  });

  it("sem dono definido: mostra travessão, não quebra", () => {
    const html = render({ items: [item({ ownerName: null, ownerEmail: null })] });
    expect(html).toContain("—");
  });

  it("lista vazia sem filtros: mensagem genérica, sem link de limpar filtros", () => {
    const html = render({ items: [], total: 0 });
    expect(html).toContain("Nenhuma organização ainda");
    expect(html).not.toContain("Limpar filtros");
  });

  it("lista vazia com filtro ativo: mensagem + link para limpar", () => {
    const html = render({ items: [], total: 0, params: { q: "acme" } });
    expect(html).toContain("Nenhuma organização com esses filtros");
    expect(html).toContain("Limpar filtros");
  });

  it("paginação: página do meio tem Anterior e Próxima habilitados", () => {
    const html = render({ page: 2, totalPages: 3, total: 40 });
    expect(html).toContain("Página 2 de 3");
    expect(html).toContain('href="/admin/organizacoes?page=1"');
    expect(html).toContain('href="/admin/organizacoes?page=3"');
  });

  it("paginação: primeira página desabilita Anterior; última desabilita Próxima", () => {
    const first = render({ page: 1, totalPages: 2, total: 25 });
    expect(first).toMatch(/aria-disabled="true"[^>]*>\s*Anterior/);
    const last = render({ page: 2, totalPages: 2, total: 25 });
    expect(last).toMatch(/aria-disabled="true"[^>]*>\s*Próxima/);
  });
});
