// @vitest-environment node
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { NotificationBell } from "./NotificationBell";
import { NotificationRow } from "./NotificationRow";
import { NotificationsList } from "./NotificationsList";
import { NotificationsProvider } from "./NotificationsProvider";
import type { NotificationItem, NotificationSummaryState } from "@/lib/notifications/client-types";

const sum = (n: number): NotificationSummaryState => ({ unreadTotal: n, byArea: { calendario: 0, leads: 0, configuracoes: 0, aprovacoes: 0 } });
const bell = (n: number) => renderToStaticMarkup(<NotificationsProvider initial={sum(n)}><NotificationBell /></NotificationsProvider>);

describe("sino", () => {
  it("com não lidas: aria-label com N, ponto/contador #1fb390 aria-hidden", () => {
    const html = bell(3);
    expect(html).toContain('aria-label="Notificações, 3 não lidas"');
    expect(html).toContain("bg-[#1fb390]");
    expect(html).toContain('data-has-unread="true"');
    expect(html).toContain(">3<");
  });
  it("99+ acima de 99", () => {
    expect(bell(150)).toContain(">99+<");
    expect(bell(99)).toContain(">99<");
  });
  it("com 0: sem ponto e rótulo neutro", () => {
    const html = bell(0);
    expect(html).not.toContain('data-slot="bell-count"');
    expect(html).toContain('aria-label="Notificações, nenhuma não lida"');
    expect(html).toContain('data-has-unread="false"');
  });
  it("Sheet fechado por padrão (conteúdo só ao abrir; foco volta ao gatilho via base-ui)", () => {
    expect(bell(2)).not.toContain("Marcar todas como lidas");
  });
});

const item = (over: Partial<NotificationItem> = {}): NotificationItem => ({
  id: "11111111-2222-3333-4444-555555555555", kind: "meeting_reminder", severity: "alta", title: "Reunião em 15 min", body: "Você tem uma reunião agendada. Abra o app para ver os detalhes.",
  refType: "meeting", refId: "99999999-2222-3333-4444-555555555555", link: null, createdAt: new Date(Date.now() - 5 * 60_000).toISOString(), readAt: null, resolvedAt: null, area: "calendario", ...over,
});

describe("linha de notificação", () => {
  it("não lida: marcar como lida + link Abrir para a reunião + texto sr-only", () => {
    const html = renderToStaticMarkup(<ul><NotificationRow item={item()} onRead={vi.fn()} /></ul>);
    expect(html).toContain("Marcar como lida");
    expect(html).toContain('href="/calendario?meeting=99999999-2222-3333-4444-555555555555"');
    expect(html).toContain("(não lida)");
    expect(html).toContain("há 5 minutos");
  });
  it("lida: sem botão de marcar; handoff aponta para o lead", () => {
    const html = renderToStaticMarkup(<ul><NotificationRow item={item({ readAt: new Date().toISOString(), kind: "handoff", refType: "lead", area: "leads", refId: "aaaaaaaa-2222-3333-4444-555555555555" })} onRead={vi.fn()} /></ul>);
    expect(html).not.toContain("Marcar como lida");
    expect(html).toContain('href="/leads/aaaaaaaa-2222-3333-4444-555555555555"');
  });
});

describe("página /notificacoes", () => {
  it("filtros de área, tipo e situação rotulados; carregando com aria-busy", () => {
    const html = renderToStaticMarkup(<NotificationsProvider initial={sum(2)}><NotificationsList /></NotificationsProvider>);
    for (const l of ["Área", "Tipo", "Situação"]) expect(html).toContain(`>${l}</label>`);
    expect(html).toContain("Não lidas");
    expect(html).toContain("Aprovações");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Marcar todas como lidas");
  });
});
