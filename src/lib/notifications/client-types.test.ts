import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_SUMMARY, applyMarkAllRead, applyMarkRead, bellCountText, bellLabel, countFor, isSummary, navNewText, navTooltip, notificationHref, relativeTime, shouldToastReminder,
} from "./client-types";
import { claimToastIds } from "./toast-dedupe";
import { createSummaryPoller, type SummaryFetch } from "./poller";
import { buildListUrl } from "./client";

const S = { unreadTotal: 5, byArea: { calendario: 2, leads: 2, configuracoes: 1, aprovacoes: 3 } };
const UUID = "11111111-2222-3333-4444-555555555555";

describe("estado otimista", () => {
  it("marcar uma baixa total e area; nunca negativo; kind desconhecido so baixa o total", () => {
    expect(applyMarkRead(S, "meeting_reminder")).toEqual({ unreadTotal: 4, byArea: { ...S.byArea, calendario: 1 } });
    expect(applyMarkRead(EMPTY_SUMMARY, "handoff").unreadTotal).toBe(0);
    expect(applyMarkRead(S, "zzz")).toEqual({ unreadTotal: 4, byArea: S.byArea });
  });
  it("marcar todas zera alertas e preserva a fila de aprovacoes", () => {
    expect(applyMarkAllRead(S)).toEqual({ unreadTotal: 0, byArea: { calendario: 0, leads: 0, configuracoes: 0, aprovacoes: 3 } });
    expect(applyMarkAllRead(S, "leads")).toEqual({ unreadTotal: 3, byArea: { ...S.byArea, leads: 0 } });
    expect(applyMarkAllRead(S, "aprovacoes")).toEqual(S);
  });
  it("countFor e isSummary", () => {
    expect(countFor(S, "notificacoes")).toBe(5);
    expect(countFor(S, "aprovacoes")).toBe(3);
    expect(isSummary(S)).toBe(true);
    expect(isSummary({ unreadTotal: 1 })).toBe(false);
  });
});

describe("apresentacao / acessibilidade (strings)", () => {
  it("sino: aria-label e 99+", () => {
    expect(bellLabel(3)).toBe("Notificações, 3 não lidas");
    expect(bellLabel(1)).toBe("Notificações, 1 não lida");
    expect(bellLabel(0)).toBe("Notificações, nenhuma não lida");
    expect(bellCountText(99)).toBe("99");
    expect(bellCountText(100)).toBe("99+");
  });
  it("sidebar: texto sr-only e tooltip", () => {
    expect(navNewText(3)).toBe(", 3 novos itens");
    expect(navNewText(1)).toBe(", 1 novo item");
    expect(navTooltip("Leads", 2)).toBe("Leads (2 novos)");
    expect(navTooltip("Leads", 0)).toBe("Leads");
  });
  it("links por tipo de notificacao", () => {
    expect(notificationHref({ kind: "meeting_reminder", refType: "meeting", refId: UUID, area: "calendario" })).toBe(`/calendario?meeting=${UUID}`);
    expect(notificationHref({ kind: "handoff", refType: "lead", refId: UUID, area: "leads" })).toBe(`/leads/${UUID}`);
    expect(notificationHref({ kind: "wa_paused", refType: "instance", refId: null, area: "configuracoes" })).toBe("/configuracoes");
    expect(notificationHref({ kind: "x", refType: "x", refId: null, area: null })).toBe("/notificacoes");
    expect(notificationHref({ kind: "handoff", refType: "lead", refId: "../evil", area: "leads" })).toBe("/leads");
  });
  it("horario relativo pt-BR", () => {
    const now = Date.parse("2026-10-01T12:00:00Z");
    expect(relativeTime("2026-10-01T11:59:40Z", now)).toBe("agora");
    expect(relativeTime("2026-10-01T11:45:00Z", now)).toBe("há 15 minutos");
    expect(relativeTime("2026-10-01T09:00:00Z", now)).toBe("há 3 horas");
    expect(relativeTime("2026-09-29T12:00:00Z", now)).toBe("anteontem");
  });
  it("URL da lista com filtros e cursor", () => {
    expect(buildListUrl({ area: "leads", unread: "true", cursor: "abc" })).toBe("/api/notifications?area=leads&unread=true&cursor=abc&limit=20");
    expect(buildListUrl({})).toBe("/api/notifications?limit=20");
  });
});

describe("toast", () => {
  const base = { kind: "meeting_reminder", readAt: null, resolvedAt: null };
  it("so lembretes <= 15 min, nao lidos", () => {
    expect(shouldToastReminder({ ...base, title: "Reunião em 15 min" })).toBe(true);
    expect(shouldToastReminder({ ...base, title: "Reunião em 5 min" })).toBe(true);
    expect(shouldToastReminder({ ...base, title: "Reunião em 1 hora" })).toBe(false);
    expect(shouldToastReminder({ ...base, title: "Reunião em 30 min" })).toBe(false);
    expect(shouldToastReminder({ ...base, title: "Reunião em 15 min", readAt: "x" })).toBe(false);
    expect(shouldToastReminder({ ...base, kind: "handoff", title: "Reunião em 15 min" })).toBe(false);
  });
  it("dedupe por id: aparece uma vez", () => {
    const mem = new Map<string, string>();
    const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(claimToastIds(["a", "b", "a"], st)).toEqual(["a", "b"]);
    expect(claimToastIds(["a", "b", "c"], st)).toEqual(["c"]);
    expect(claimToastIds(["a"], st)).toEqual([]);
    expect(claimToastIds(["z"], null)).toEqual(["z"]);
  });
});

describe("poller (timers falsos)", () => {
  const ok = (n: number, etag: string): SummaryFetch => ({ status: "ok", summary: { ...EMPTY_SUMMARY, unreadTotal: n }, etag });
  const make = (results: SummaryFetch[], visible = () => true) => {
    let i = 0;
    const fetchSummary = vi.fn(async (etag: string | null) => (void etag, results[Math.min(i++, results.length - 1)]));
    const onSummary = vi.fn();
    const p = createSummaryPoller({ fetchSummary, onSummary, isVisible: visible });
    return { fetchSummary, onSummary, p };
  };

  it("busca a cada 30 s, envia If-None-Match e trata 304 sem trocar estado", async () => {
    vi.useFakeTimers();
    try {
      const { fetchSummary, onSummary, p } = make([ok(2, '"e1"'), { status: "not-modified" }]);
      p.start();
      p.start(); // idempotente: um unico timer
      await vi.advanceTimersByTimeAsync(29_000);
      expect(fetchSummary).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(fetchSummary).toHaveBeenCalledTimes(1);
      expect(fetchSummary.mock.calls[0][0]).toBeNull();
      expect(onSummary).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetchSummary).toHaveBeenCalledTimes(2);
      expect(fetchSummary.mock.calls[1][0]).toBe('"e1"');
      expect(onSummary).toHaveBeenCalledTimes(1);
      p.stop();
      await vi.advanceTimersByTimeAsync(90_000);
      expect(fetchSummary).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it("pausa com aba oculta e retoma ao ficar visivel", async () => {
    vi.useFakeTimers();
    try {
      let visible = false;
      const { fetchSummary, p } = make([ok(1, '"a"')], () => visible);
      p.start();
      await vi.advanceTimersByTimeAsync(90_000);
      expect(fetchSummary).not.toHaveBeenCalled();
      visible = true;
      p.onVisible();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchSummary).toHaveBeenCalledTimes(1);
      p.stop();
    } finally { vi.useRealTimers(); }
  });

  it("erro de rede nao derruba nem zera o estado e o proximo ciclo continua", async () => {
    vi.useFakeTimers();
    try {
      const { fetchSummary, onSummary, p } = make([{ status: "error" }, ok(4, '"b"')]);
      p.start();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(onSummary).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(onSummary).toHaveBeenCalledWith(expect.objectContaining({ unreadTotal: 4 }));
      const throwing = createSummaryPoller({ fetchSummary: async () => { throw new Error("boom"); }, onSummary });
      await expect(throwing.refresh()).resolves.toBeUndefined();
      expect(fetchSummary).toHaveBeenCalledTimes(2);
      p.stop();
    } finally { vi.useRealTimers(); }
  });

  it("refresh ignora o ETag e nao sobrepoe requisicoes", async () => {
    const { fetchSummary, p } = make([ok(1, '"a"'), ok(2, '"b"')]);
    await p.refresh();
    await p.refresh();
    expect(fetchSummary.mock.calls.map((c) => c[0])).toEqual([null, null]);
    const slow = vi.fn(() => new Promise<SummaryFetch>((r) => setTimeout(() => r(ok(1, '"a"')), 10)));
    const p2 = createSummaryPoller({ fetchSummary: slow, onSummary: vi.fn() });
    await Promise.all([p2.refresh(), p2.refresh()]);
    expect(slow).toHaveBeenCalledTimes(1);
  });
});
