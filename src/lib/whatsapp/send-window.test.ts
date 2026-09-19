import { describe, expect, it } from "vitest";
import { earliestInWindow, isWithinSendWindow, nextWindowStart, resolveTimezone } from "./send-window";
import { nextAllowedSendAt } from "./rate";

const SP = "America/Sao_Paulo"; // UTC-3 fixo
const d = (s: string) => new Date(s);

describe("isWithinSendWindow", () => {
  it("limites 07:59, 08:00, 17:59, 18:00 (SP)", () => {
    expect(isWithinSendWindow(SP, d("2026-06-10T10:59:00Z"))).toBe(false);
    expect(isWithinSendWindow(SP, d("2026-06-10T11:00:00Z"))).toBe(true);
    expect(isWithinSendWindow(SP, d("2026-06-10T20:59:00Z"))).toBe(true);
    expect(isWithinSendWindow(SP, d("2026-06-10T21:00:00Z"))).toBe(false);
  });
  it("fusos diferentes para o mesmo instante", () => {
    const t = d("2026-06-10T12:00:00Z"); // SP 09:00, Tóquio 21:00, NY 08:00 (EDT)
    expect(isWithinSendWindow(SP, t)).toBe(true);
    expect(isWithinSendWindow("Asia/Tokyo", t)).toBe(false);
    expect(isWithinSendWindow("America/New_York", t)).toBe(true);
  });
  it("timezone inválido/ausente cai em America/Sao_Paulo", () => {
    const t = d("2026-06-10T12:00:00Z");
    expect(resolveTimezone("Marte/Olimpo")).toBe(SP);
    expect(isWithinSendWindow("Marte/Olimpo", t)).toBe(true);
    expect(isWithinSendWindow(null, d("2026-06-10T22:00:00Z"))).toBe(false);
    expect(isWithinSendWindow(undefined, t)).toBe(true);
  });
  it("DST: NY antes/depois de 8/mar/2026 (08:00 local = 13:00Z antes, 12:00Z depois)", () => {
    expect(isWithinSendWindow("America/New_York", d("2026-03-07T12:59:00Z"))).toBe(false);
    expect(isWithinSendWindow("America/New_York", d("2026-03-07T13:00:00Z"))).toBe(true);
    expect(isWithinSendWindow("America/New_York", d("2026-03-09T11:59:00Z"))).toBe(false);
    expect(isWithinSendWindow("America/New_York", d("2026-03-09T12:00:00Z"))).toBe(true);
  });
});

describe("nextWindowStart", () => {
  it("antes das 8h -> hoje 08:00; a partir das 8h -> amanhã 08:00", () => {
    expect(nextWindowStart(SP, d("2026-06-10T10:59:00Z")).toISOString()).toBe("2026-06-10T11:00:00.000Z");
    expect(nextWindowStart(SP, d("2026-06-10T11:00:00Z")).toISOString()).toBe("2026-06-11T11:00:00.000Z");
    expect(nextWindowStart(SP, d("2026-06-10T21:00:00Z")).toISOString()).toBe("2026-06-11T11:00:00.000Z");
  });
  it("virada de dia e de mês/ano", () => {
    expect(nextWindowStart(SP, d("2026-06-10T02:00:00Z")).toISOString()).toBe("2026-06-10T11:00:00.000Z"); // 23:00 do dia 9
    expect(nextWindowStart(SP, d("2026-06-30T20:00:00Z")).toISOString()).toBe("2026-07-01T11:00:00.000Z");
    expect(nextWindowStart(SP, d("2026-12-31T20:00:00Z")).toISOString()).toBe("2027-01-01T11:00:00.000Z");
  });
  it("DST NY: início (8/mar) e fim (1/nov) de horário de verão", () => {
    // 7/mar 20:00 EST -> 8/mar 08:00 EDT = 12:00Z
    expect(nextWindowStart("America/New_York", d("2026-03-08T01:00:00Z")).toISOString()).toBe("2026-03-08T12:00:00.000Z");
    // 31/out 20:00 EDT -> 1/nov 08:00 EST = 13:00Z
    expect(nextWindowStart("America/New_York", d("2026-11-01T00:00:00Z")).toISOString()).toBe("2026-11-01T13:00:00.000Z");
  });
  it("São Paulo não muda em datas de DST do hemisfério norte", () => {
    expect(nextWindowStart(SP, d("2026-03-08T01:00:00Z")).toISOString()).toBe("2026-03-08T11:00:00.000Z");
  });
  it("earliestInWindow mantém instante dentro da janela e move o de fora", () => {
    const inside = d("2026-06-10T15:00:00Z");
    expect(earliestInWindow(SP, inside)).toBe(inside);
    expect(earliestInWindow(SP, d("2026-06-10T22:00:00Z")).toISOString()).toBe("2026-06-11T11:00:00.000Z");
  });
});

describe("nextAllowedSendAt", () => {
  const now = d("2026-06-10T15:00:00Z");
  it("sem envio anterior -> agora", () => expect(nextAllowedSendAt(null, now, () => 0.5)).toBe(now));
  it("intervalo mínimo 20s e máximo 60s", () => {
    expect(nextAllowedSendAt(now, now, () => 0).getTime() - now.getTime()).toBe(20_000);
    expect(nextAllowedSendAt(now, now, () => 0.999999).getTime() - now.getTime()).toBe(60_000);
  });
  it("já passou o intervalo -> agora", () => {
    expect(nextAllowedSendAt(new Date(now.getTime() - 61_000), now, () => 0.999999)).toBe(now);
  });
  it("respeita o tempo já decorrido", () => {
    expect(nextAllowedSendAt(new Date(now.getTime() - 10_000), now, () => 0).getTime() - now.getTime()).toBe(10_000);
  });
});
