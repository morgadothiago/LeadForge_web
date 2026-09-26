// @vitest-environment node
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/actions/meeting", () => ({ createMeeting: vi.fn(), updateMeeting: vi.fn(), cancelMeeting: vi.fn(), markMeetingDone: vi.fn(), markMeetingNoShow: vi.fn() }));
vi.mock("@/lib/actions/meeting-search", () => ({ searchMeetingLeads: vi.fn() }));

import { CalendarView } from "./CalendarView";
import type { CalendarMeeting } from "./types";

const m = (over: Partial<CalendarMeeting>): CalendarMeeting => ({
  id: "11111111-2222-3333-4444-555555555555", opportunityId: "o", leadId: "l", leadName: "Ana Souza", company: "Acme", campaignId: "c", campaignName: "Campanha X",
  startsAt: "2026-10-01T17:00:00.000Z", endsAt: "2026-10-01T17:30:00.000Z", durationMin: 30, timezone: "America/Sao_Paulo", status: "scheduled", link: null, notes: null, source: "manual", ...over,
});
const render = (view: "month" | "week" | "day", dateKey: string, meetings: CalendarMeeting[], extra: Partial<React.ComponentProps<typeof CalendarView>> = {}) =>
  renderToStaticMarkup(<CalendarView view={view} dateKey={dateKey} todayKey="2026-10-01" meetings={meetings} {...extra} />);

// A mesma reuniao (14:00 em SP) deve aparecer no dia/hora certos com o processo em UTC ou Tokyo.
for (const tz of ["UTC", "Asia/Tokyo"]) {
  describe(`CalendarView (process TZ=${tz})`, () => {
    const withTz = <T,>(fn: () => T): T => {
      const prev = process.env.TZ;
      process.env.TZ = tz;
      try { return fn(); } finally { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; }
    };

    it("mês: chip com hora 14:00 na célula de 01/10; +N mais quando passa de 3", () => {
      withTz(() => {
        const html = render("month", "2026-10-01", [m({})]);
        expect(html).toContain('data-view="month"');
        expect(html).toMatch(/data-day="2026-10-01"[^]*?14:00[^]*?Ana Souza/);
        expect(html).toContain("Outubro de 2026");
        const many = [1, 2, 3, 4, 5].map((i) => m({ id: `1111111${i}-2222-3333-4444-555555555555`, leadName: `Lead ${i}` }));
        expect(render("month", "2026-10-01", many)).toContain("+2 mais");
      });
    });

    it("semana: 7 colunas, GMT-3, bloco 14:00–14:30 e virada de meia-noite no dia anterior", () => {
      withTz(() => {
        const html = render("week", "2026-10-01", [m({}), m({ id: "22222222-2222-3333-4444-555555555555", leadName: "Noite", startsAt: "2026-10-01T02:30:00.000Z", endsAt: "2026-10-01T03:30:00.000Z" })]);
        expect(html).toContain('data-view="week"');
        expect((html.match(/data-day="2026-09-2[89]"|data-day="2026-09-30"|data-day="2026-10-0[1-4]"/g) ?? []).length).toBeGreaterThanOrEqual(7);
        expect(html).toContain("GMT-3");
        expect(html).toContain("14:00–14:30");
        // 23:30-00:30 aparece nos dois dias (30/09 e 01/10)
        expect((html.match(/aria-label="23:30 Noite/g) ?? []).length).toBe(2);
        expect(html).toMatch(/data-day="2026-09-30"[^]*?aria-label="23:30 Noite[^]*?data-day="2026-10-01"[^]*?aria-label="23:30 Noite/);
      });
    });

    it("dia: 1 coluna e navegação", () => {
      withTz(() => {
        const html = render("day", "2026-10-01", [m({})]);
        expect(html).toContain('data-view="day"');
        expect(html).toContain('href="/calendario?view=day&amp;date=2026-10-02"');
        expect(html).toContain('href="/calendario?view=day&amp;date=2026-09-30"');
        expect(html).toContain('href="/calendario?view=month&amp;date=2026-10-01"');
      });
    });
  });
}

describe("CalendarView: estados e acessibilidade", () => {
  it("agenda (<640px) lista por dia; vazia mostra mensagem; grades ficam escondidas em mobile", () => {
    const html = render("week", "2026-10-01", [m({})]);
    expect(html).toContain('data-view="agenda"');
    expect(html).toContain("sm:hidden");
    expect(html).toContain("Quinta-feira, 1 de outubro de 2026");
    expect(html).toContain("14:00–14:30 · Agendada");
    expect(render("week", "2026-10-01", [])).toContain("Nenhuma reunião neste período.");
  });
  it("cancelada riscada; status acessível no rótulo", () => {
    const html = render("day", "2026-10-01", [m({ status: "cancelled" })]);
    expect(html).toContain("line-through");
    expect(html).toContain("Cancelada");
  });
  it("controles nomeados e vista atual com aria-current", () => {
    const html = render("week", "2026-10-01", []);
    expect(html).toContain('aria-label="Período anterior"');
    expect(html).toContain('aria-label="Próximo período"');
    expect(html).toContain("Nova reunião");
    expect(html).toContain('aria-label="Modo de visualização"');
    expect(html).toMatch(/aria-current="page"[^>]*>Semana|>Semana<\/a>/);
    expect(html).toContain("Hoje");
  });
  it("erro do intervalo aparece em role=alert", () => {
    expect(render("week", "2026-10-01", [], { error: "Intervalo máximo: 62 dias." })).toContain('role="alert"');
  });
  it("Segunda é o primeiro dia da semana na grade do mês", () => {
    const html = render("month", "2026-10-01", []);
    expect(html.indexOf(">Seg<")).toBeLessThan(html.indexOf(">Dom<"));
  });
});
