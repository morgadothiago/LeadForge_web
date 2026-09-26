import { describe, expect, it } from "vitest";
import {
  addDays, addMonths, dayKeyOf, findConflicts, formatTime, groupByDay, instantAt, isDayKey, minutesOfDay, monthGridKeys, segmentForDay, shiftDate, viewTitle,
  visibleRange, weekKeys, weekStartKey, weekdayIndex,
} from "./tz";

// O mesmo arquivo roda com TZ=UTC e TZ=Asia/Tokyo (ver bloco abaixo): os resultados nao podem depender do fuso do processo.
const run = (tzName: string) => {
  describe(`helpers de calendario (process TZ=${tzName})`, () => {
    const prev = process.env.TZ;
    const setTz = () => { process.env.TZ = tzName; };
    const restore = () => { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; };

    it("virada de dia em Sao Paulo: 23:30 e 00:30 locais caem em dias diferentes", () => {
      setTz();
      try {
        const late = new Date("2026-10-01T02:30:00Z"); // 23:30 de 30/09 em SP (-03:00)
        const early = new Date("2026-10-01T03:30:00Z"); // 00:30 de 01/10 em SP
        expect(dayKeyOf(late)).toBe("2026-09-30");
        expect(dayKeyOf(early)).toBe("2026-10-01");
        expect(minutesOfDay(late)).toBe(23 * 60 + 30);
        expect(minutesOfDay(early)).toBe(30);
        expect(formatTime(late)).toBe("23:30");
      } finally { restore(); }
    });

    it("instantAt e inverso de dayKeyOf/minutesOfDay", () => {
      setTz();
      try {
        const d = instantAt("2026-10-01", 14 * 60);
        expect(d.toISOString()).toBe("2026-10-01T17:00:00.000Z");
        expect(dayKeyOf(d)).toBe("2026-10-01");
        expect(minutesOfDay(d)).toBe(840);
        expect(instantAt("2026-10-01", 1440).toISOString()).toBe(instantAt("2026-10-02", 0).toISOString());
      } finally { restore(); }
    });

    it("semana comeca na segunda (01/10/2026 e quinta)", () => {
      setTz();
      try {
        expect(weekdayIndex("2026-10-01")).toBe(3);
        expect(weekStartKey("2026-10-01")).toBe("2026-09-28");
        expect(weekStartKey("2026-09-28")).toBe("2026-09-28");
        expect(weekStartKey("2026-10-04")).toBe("2026-09-28"); // domingo pertence a semana da segunda anterior
        expect(weekKeys("2026-10-01")).toHaveLength(7);
        expect(weekKeys("2026-10-01")[6]).toBe("2026-10-04");
      } finally { restore(); }
    });

    it("grade do mes: 42 dias, inicia na segunda, contem o mes inteiro", () => {
      setTz();
      try {
        const g = monthGridKeys("2026-10-15");
        expect(g).toHaveLength(42);
        expect(g[0]).toBe("2026-09-28");
        expect(g).toContain("2026-10-31");
        expect(weekdayIndex(g[0])).toBe(0);
      } finally { restore(); }
    });

    it("intervalo visivel e meia-aberto em ISO, dentro do teto de 62 dias", () => {
      setTz();
      try {
        const m = visibleRange("month", "2026-10-15");
        expect(m.from).toBe("2026-09-28T03:00:00.000Z");
        expect(m.to).toBe("2026-11-09T03:00:00.000Z");
        expect((Date.parse(m.to) - Date.parse(m.from)) / 86_400_000).toBeLessThanOrEqual(62);
        const d = visibleRange("day", "2026-10-01");
        expect(d).toMatchObject({ from: "2026-10-01T03:00:00.000Z", to: "2026-10-02T03:00:00.000Z" });
        expect(visibleRange("week", "2026-10-01").days).toHaveLength(7);
      } finally { restore(); }
    });

    it("reuniao aparece no dia/hora certos e cruzando a meia-noite gera dois segmentos", () => {
      setTz();
      try {
        const a = { id: "a", startsAt: new Date("2026-10-01T02:30:00Z"), endsAt: new Date("2026-10-01T03:30:00Z") }; // 23:30-00:30 SP
        expect(segmentForDay(a.startsAt, a.endsAt, "2026-09-30")).toEqual({ startMin: 1410, endMin: 1440 });
        expect(segmentForDay(a.startsAt, a.endsAt, "2026-10-01")).toEqual({ startMin: 0, endMin: 30 });
        expect(segmentForDay(a.startsAt, a.endsAt, "2026-10-02")).toBeNull();
        const g = groupByDay([a], ["2026-09-30", "2026-10-01", "2026-10-02"]);
        expect(g.get("2026-09-30")).toHaveLength(1);
        expect(g.get("2026-10-01")).toHaveLength(1);
        expect(g.get("2026-10-02")).toHaveLength(0);
      } finally { restore(); }
    });

    it("conflito: sobreposicao real; encostar nao conflita; cancelada e o proprio id ignorados", () => {
      setTz();
      try {
        const t = (h: number) => new Date(Date.UTC(2026, 9, 1, h));
        const items = [
          { id: "1", startsAt: t(12), endsAt: t(13), status: "scheduled" },
          { id: "2", startsAt: t(13), endsAt: t(14), status: "scheduled" },
          { id: "3", startsAt: t(12), endsAt: t(14), status: "cancelled" },
        ];
        expect(findConflicts(items, t(12), t(13)).map((m) => m.id)).toEqual(["1"]);
        expect(findConflicts(items, t(12), t(13), "1")).toEqual([]);
      } finally { restore(); }
    });
  });
};
run("UTC");
run("Asia/Tokyo");

describe("aritmetica de chaves", () => {
  it("validacao, addDays/addMonths e navegacao por vista", () => {
    expect(isDayKey("2026-02-30")).toBe(false);
    expect(isDayKey("2026-10-01")).toBe(true);
    expect(isDayKey("x")).toBe(false);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-01");
    expect(shiftDate("week", "2026-10-01", -1)).toBe("2026-09-24");
    expect(shiftDate("day", "2026-10-01", 1)).toBe("2026-10-02");
    expect(shiftDate("month", "2026-10-31", 1)).toBe("2026-11-01");
  });
  it("titulos em pt-BR", () => {
    expect(viewTitle("month", "2026-10-01")).toBe("Outubro de 2026");
    expect(viewTitle("day", "2026-10-01")).toMatch(/^Quinta-feira, 1 de outubro de 2026$/);
    expect(viewTitle("week", "2026-10-01")).toContain("28 de set");
  });
});
