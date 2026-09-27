// @vitest-environment node
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_NAV_ITEMS, NAV_ITEMS } from "./nav-items";

const state = { pathname: "/dashboard", mobile: false };
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname, useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => state.mobile }));
vi.mock("@/lib/actions/auth", () => ({ logout: vi.fn() }));

import { AppSidebar } from "./AppSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { NotificationsProvider } from "@/components/notifications/NotificationsProvider";
import { EMPTY_SUMMARY, type NotificationSummaryState } from "@/lib/notifications/client-types";

const user = { name: "Ana", email: "ana@x.com" };
const render = (defaultOpen = true, summary: NotificationSummaryState = EMPTY_SUMMARY, platformRole?: "provider" | "platform_admin") =>
  renderToStaticMarkup(
    <SidebarProvider defaultOpen={defaultOpen}>
      <NotificationsProvider initial={summary}>
        <AppSidebar user={user} platformRole={platformRole} />
      </NotificationsProvider>
    </SidebarProvider>,
  );
const withNew: NotificationSummaryState = { unreadTotal: 3, byArea: { calendario: 1, leads: 2, configuracoes: 0, aprovacoes: 4 } };
const dots = (html: string) => (html.match(/data-slot="new-dot"/g) ?? []).length;
const currentCount = (html: string) => (html.match(/aria-current="page"/g) ?? []).length;

beforeEach(() => {
  state.pathname = "/dashboard";
  state.mobile = false;
});

describe("AppSidebar", () => {
  it("renderiza os 9 itens de NAV_ITEMS com href e rótulo, dentro de nav nomeado", () => {
    const html = render();
    expect(html).toContain('aria-label="Navegação principal"');
    for (const { href, label } of NAV_ITEMS) {
      expect(html).toContain(`href="${href}"`);
      expect(html).toContain(label);
    }
    expect(NAV_ITEMS).toHaveLength(9);
  });

  it.each(NAV_ITEMS.map((i) => i.href))("rota %s marca exatamente um item ativo", (href) => {
    state.pathname = href;
    const html = render();
    expect(currentCount(html)).toBe(1);
    expect(html).toMatch(new RegExp(`aria-current="page"[^>]*href="${href}"|href="${href}"[^>]*aria-current="page"`));
  });

  it("subrota ativa o item pai; rota desconhecida não ativa nenhum", () => {
    state.pathname = "/leads/123";
    expect(currentCount(render())).toBe(1);
    state.pathname = "/leadsx";
    expect(currentCount(render())).toBe(0);
    state.pathname = "/nada";
    expect(currentCount(render())).toBe(0);
  });

  it("footer: gatilho do dropdown com iniciais, nome e e-mail; Sair fica dentro do menu", () => {
    const html = render();
    expect(html).toContain("ana@x.com");
    expect(html).toContain("Ana");
    expect(html).toContain(">AN<");
    expect(html).toContain('aria-label="Menu do usuário Ana"');
    expect(html).not.toContain("Sair");
  });

  it("modo ícone mantém o texto do rótulo (nome acessível) e reflete o estado no provider", () => {
    const html = render(false);
    expect(html).toContain('data-state="collapsed"');
    expect(html).toContain('data-collapsible="icon"');
    for (const { label } of NAV_ITEMS) expect(html).toContain(label);
  });

  it("expandida: data-state=expanded", () => {
    expect(render(true)).toContain('data-state="expanded"');
  });

  it("desktop renderiza a sidebar fixa; mobile renderiza Sheet (fechado, sem sidebar fixa)", () => {
    expect(render()).toContain('data-slot="sidebar-container"');
    state.mobile = true;
    expect(render()).not.toContain('data-slot="sidebar-container"');
  });

  it("rail tem nome acessível em PT-BR", () => {
    expect(render()).toContain('aria-label="Recolher ou expandir menu"');
  });

  it("Calendário e Notificações navegam e ficam ativos", () => {
    for (const href of ["/calendario", "/notificacoes"]) {
      state.pathname = href;
      const html = render();
      expect(html).toContain(`href="${href}"`);
      expect(currentCount(html)).toBe(1);
    }
  });

  it("sem novidades: nenhuma bolinha nem texto sr-only de novos", () => {
    const html = render();
    expect(dots(html)).toBe(0);
    expect(html).not.toContain("novos itens");
    expect(html).not.toContain("data-has-new");
  });

  it("com novidades: bolinha bg-primary + sr-only só nos itens com contagem (Pipeline nunca)", () => {
    const html = render(true, withNew);
    // Calendário(1), Leads(2), Aprovações(4), Notificações(3); Configurações=0 e Pipeline sem badgeKey
    expect(dots(html)).toBe(4);
    expect(html).toContain(", 1 novo item");
    expect(html).toContain(", 2 novos itens");
    expect(html).toContain(", 4 novos itens");
    expect(html).toContain(", 3 novos itens");
    expect(html).toContain("bg-primary");
    expect(html).toContain('aria-hidden="true" data-slot="new-dot"');
    expect((html.match(/data-has-new="true"/g) ?? []).length).toBe(4);
  });

  it("modo ícone: bolinha posicionada no canto do ícone e texto sr-only preservados", () => {
    const html = render(false, withNew);
    expect(html).toContain('data-state="collapsed"');
    expect(dots(html)).toBe(4);
    expect(html).toContain("group-data-[collapsible=icon]:absolute");
    expect(html).toContain(", 2 novos itens");
  });

  it("aria-current preservado em item com novidade", () => {
    state.pathname = "/leads";
    const html = render(true, withNew);
    expect(currentCount(html)).toBe(1);
    expect(html).toMatch(/aria-current="page"/);
  });

  describe("SPEC-032: platformRole", () => {
    it("provider (padrão/explícito): vê os 9 itens de NAV_ITEMS, nunca 'Administração'", () => {
      const html = render(true, EMPTY_SUMMARY, "provider");
      for (const { label } of NAV_ITEMS) expect(html).toContain(label);
      expect(html).not.toContain("Administração");
      expect(html).not.toContain('href="/admin/organizacoes"');
    });

    it("platform_admin: vê SÓ 'Administração', nenhum item de NAV_ITEMS (Dashboard/Leads/Campanhas...)", () => {
      const html = render(true, EMPTY_SUMMARY, "platform_admin");
      // Escopo na <nav> de navegação principal (exclui o link de marca no header, que sempre aponta pra /dashboard).
      const nav = html.match(/<nav aria-label="Navegação principal">[\s\S]*?<\/nav>/)![0];
      expect(nav).toContain("Administração");
      expect(nav).toContain('href="/admin/organizacoes"');
      for (const { label, href } of NAV_ITEMS) {
        expect(nav).not.toContain(`href="${href}"`);
        if (!ADMIN_NAV_ITEMS.some((i) => i.label === label)) expect(nav).not.toContain(label);
      }
    });

    it("platform_admin: item 'Administração' fica ativo em /admin/organizacoes e em subrotas", () => {
      state.pathname = "/admin/organizacoes/123";
      const html = render(true, EMPTY_SUMMARY, "platform_admin");
      expect(currentCount(html)).toBe(1);
    });
  });
});
