import { describe, expect, it } from "vitest";
import { dayLabel, formatListTime, initials, linkify, windowHint } from "./inbox-format";

const NOW = new Date(2026, 9, 12, 15, 0, 0); // hora local

describe("hora e dia", () => {
  it("lista: hoje = HH:mm, ontem, dd/MM, outro ano com ano", () => {
    expect(formatListTime(new Date(2026, 9, 12, 9, 5).toISOString(), NOW)).toBe("09:05");
    expect(formatListTime(new Date(2026, 9, 11, 23, 59).toISOString(), NOW)).toBe("Ontem");
    expect(formatListTime(new Date(2026, 8, 30, 10, 0).toISOString(), NOW)).toBe("30/09");
    expect(formatListTime(new Date(2025, 11, 31, 10, 0).toISOString(), NOW)).toBe("31/12/2025");
  });
  it("separador: Hoje, Ontem, dd/MM/aaaa", () => {
    expect(dayLabel(new Date(2026, 9, 12, 1, 0).toISOString(), NOW)).toBe("Hoje");
    expect(dayLabel(new Date(2026, 9, 11, 1, 0).toISOString(), NOW)).toBe("Ontem");
    expect(dayLabel(new Date(2026, 9, 1, 1, 0).toISOString(), NOW)).toBe("01/10/2026");
  });
  it("iniciais", () => {
    expect(initials("Ana Souza Lima")).toBe("AL");
    expect(initials("ana")).toBe("AN");
    expect(initials("")).toBe("?");
  });
  it("dica da janela so nas ultimas 3 horas", () => {
    const now = Date.parse("2026-10-12T12:00:00Z");
    expect(windowHint("2026-10-12T13:00:00Z", now)).toMatch(/Você pode responder até/);
    expect(windowHint("2026-10-12T20:00:00Z", now)).toBeNull();
    expect(windowHint("2026-10-12T11:00:00Z", now)).toBeNull();
    expect(windowHint(null, now)).toBeNull();
  });
});

describe("linkify (so http/https)", () => {
  it("transforma http/https e tira pontuacao final", () => {
    expect(linkify("veja https://exemplo.com/a?b=1, ok")).toEqual([
      { type: "text", value: "veja " },
      { type: "link", value: "https://exemplo.com/a?b=1", href: "https://exemplo.com/a?b=1" },
      { type: "text", value: ", ok" },
    ]);
  });
  it("javascript:, data: e ftp: NUNCA viram link", () => {
    for (const t of ["javascript:alert(1)", "data:text/html,<script>1</script>", "ftp://x.com/a", "JaVaScRiPt:alert(1)"]) {
      expect(linkify(t).every((s) => s.type === "text")).toBe(true);
    }
  });
  it("texto com HTML permanece texto cru (o React escapa na renderizacao)", () => {
    const segs = linkify('<img src=x onerror=alert(1)> <script>x</script>');
    expect(segs).toEqual([{ type: "text", value: '<img src=x onerror=alert(1)> <script>x</script>' }]);
  });
  it("http com host invalido fica texto", () => {
    expect(linkify("http://").every((s) => s.type === "text")).toBe(true);
  });
});
