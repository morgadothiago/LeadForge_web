// @vitest-environment node
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const unread = { unreadMessages: 0, unreadConversations: 0, refresh: () => {} };
vi.mock("@/components/inbox/InboxUnreadProvider", () => ({ useInboxUnread: () => unread, InboxUnreadProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("next/navigation", () => ({ usePathname: () => "/atendimento", useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/actions/auth", () => ({ logout: vi.fn() }));

import { AppSidebar } from "@/components/layout/AppSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { NotificationsProvider } from "@/components/notifications/NotificationsProvider";
import { EMPTY_SUMMARY } from "@/lib/notifications/client-types";

const render = () =>
  renderToStaticMarkup(
    <SidebarProvider defaultOpen>
      <NotificationsProvider initial={EMPTY_SUMMARY}>
        <AppSidebar user={{ name: "Ana", email: "a@x.com" }} />
      </NotificationsProvider>
    </SidebarProvider>,
  );

describe("sidebar: item Atendimento (SPEC-068b)", () => {
  it("sem nao lidas: item presente e ativo, sem badge", () => {
    unread.unreadMessages = 0;
    const html = render();
    expect(html).toContain('href="/atendimento"');
    expect(html).toContain("Atendimento");
    expect(html).not.toContain('data-slot="inbox-unread"');
  });
  it("com nao lidas: badge com numero e texto sr-only; 120 vira 99+", () => {
    unread.unreadMessages = 3;
    let html = render();
    expect(html).toContain('data-slot="inbox-unread"');
    expect(html).toContain(", 3 mensagens não lidas");
    unread.unreadMessages = 1;
    expect(render()).toContain(", 1 mensagem não lida");
    unread.unreadMessages = 120;
    html = render();
    expect(html).toContain(">99+<");
  });
});
