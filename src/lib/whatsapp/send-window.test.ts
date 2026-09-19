import { describe, expect, it } from "vitest";
import { earliestInWindow, isWithinSendWindow, nextWindowStart, resolveTimezone, startOfLocalDay, startOfNextLocalDay } from "./send-window";
import { easterSunday, isBrazilianHoliday } from "./holidays";

const SP = "America/Sao_Paulo"; // UTC-3 fixo
const d = (s: string) => new Date(s);
// 2026-06-10 é quarta-feira.

describe("isWithinSendWindow (SPEC-017: seg-sex 9-12 e 14-17 local)", () => {
  it("limites 08:59, 09:00, 11:59, 12:00, 13:59, 14:00, 16:59, 17:00 (SP)", () => {
    const at = (z: string) => isWithinSendWindow(SP, d(z));
    expect(at("2026-06-10T11:59:00Z")).toBe(false); // 08:59
    expect(at("2026-06-10T12:00:00Z")).toBe(true); // 09:00
    expect(at("2026-06-10T14:59:00Z")).toBe(true); // 11:59
    expect(at("2026-06-10T15:00:00Z")).toBe(false); // 12:00
    expect(at("2026-06-10T16:59:00Z")).toBe(false); // 13:59
    expect(at("2026-06-10T17:00:00Z")).toBe(true); // 14:00
    expect(at("2026-06-10T19:59:00Z")).toBe(true); // 16:59
    expect(at("2026-06-10T20:00:00Z")).toBe(false); // 17:00
  });
  it("fim de semana fora", () => {
    expect(isWithinSendWindow(SP, d("2026-06-13T13:00:00Z"))).toBe(false); // sábado 10:00
    expect(isWithinSendWindow(SP, d("2026-06-14T13:00:00Z"))).toBe(false); // domingo
    expect(isWithinSendWindow(SP, d("2026-06-12T13:00:00Z"))).toBe(true); // sexta
  });
  it("fusos: dia da semana e hora são do lead", () => {
    const t = d("2026-06-10T12:00:00Z"); // SP 09:00, Tóquio 21:00, NY 08:00 (EDT)
    expect(isWithinSendWindow(SP, t)).toBe(true);
    expect(isWithinSendWindow("Asia/Tokyo", t)).toBe(false);
    expect(isWithinSendWindow("America/New_York", t)).toBe(false);
    expect(isWithinSendWindow("America/New_York", d("2026-06-10T13:00:00Z"))).toBe(true); // NY 09:00
    // sexta 21:00 UTC-3 = sábado 00:00Z em SP? 2026-06-12T23:00Z = sexta 20:00 SP (fora) e sábado 08:00 Tóquio (fora)
    expect(isWithinSendWindow("Asia/Tokyo", d("2026-06-12T01:00:00Z"))).toBe(true); // sexta 10:00 Tóquio
    expect(isWithinSendWindow("Asia/Tokyo", d("2026-06-13T01:00:00Z"))).toBe(false); // sábado 10:00 Tóquio
  });
  it("timezone inválido/ausente cai em America/Sao_Paulo", () => {
    const t = d("2026-06-10T12:00:00Z");
    expect(resolveTimezone("Marte/Olimpo")).toBe(SP);
    expect(isWithinSendWindow("Marte/Olimpo", t)).toBe(true);
    expect(isWithinSendWindow(null, d("2026-06-10T22:00:00Z"))).toBe(false);
    expect(isWithinSendWindow(undefined, t)).toBe(true);
  });
  it("DST: NY antes/depois de 8/mar/2026 (09:00 local = 14:00Z antes, 13:00Z depois)", () => {
    expect(isWithinSendWindow("America/New_York", d("2026-03-06T13:59:00Z"))).toBe(false); // sexta EST 08:59
    expect(isWithinSendWindow("America/New_York", d("2026-03-06T14:00:00Z"))).toBe(true);
    expect(isWithinSendWindow("America/New_York", d("2026-03-09T12:59:00Z"))).toBe(false); // segunda EDT 08:59
    expect(isWithinSendWindow("America/New_York", d("2026-03-09T13:00:00Z"))).toBe(true);
  });
  it("feriado nacional fecha o dia (mesmo em dia útil)", () => {
    expect(isWithinSendWindow(SP, d("2026-09-07T13:00:00Z"))).toBe(false); // segunda, Independência
    expect(isWithinSendWindow(SP, d("2026-12-25T13:00:00Z"))).toBe(false); // sexta, Natal
    expect(isWithinSendWindow(SP, d("2026-04-03T13:00:00Z"))).toBe(false); // Sexta Santa 2026
    expect(isWithinSendWindow(SP, d("2026-09-08T13:00:00Z"))).toBe(true);
  });
});

describe("feriados nacionais", () => {
  it("Páscoa 2026 = 5/abr; 2027 = 28/mar", () => {
    expect(easterSunday(2026)).toEqual({ mo: 4, d: 5 });
    expect(easterSunday(2027)).toEqual({ mo: 3, d: 28 });
  });
  it("móveis 2026: Carnaval 16-17/fev, Sexta Santa 3/abr, Corpus Christi 4/jun", () => {
    for (const [mo, day] of [[2, 16], [2, 17], [4, 3], [6, 4]]) expect(isBrazilianHoliday(2026, mo, day)).toBe(true);
    expect(isBrazilianHoliday(2026, 6, 5)).toBe(false);
  });
  it("móveis 2027: Carnaval 8-9/fev, Sexta Santa 26/mar, Corpus Christi 27/mai", () => {
    for (const [mo, day] of [[2, 8], [2, 9], [3, 26], [5, 27]]) expect(isBrazilianHoliday(2027, mo, day)).toBe(true);
  });
  it("fixos incluem 20/nov (Consciência Negra) e 1/jan", () => {
    expect(isBrazilianHoliday(2026, 11, 20)).toBe(true);
    expect(isBrazilianHoliday(2027, 1, 1)).toBe(true);
    expect(isBrazilianHoliday(2026, 11, 21)).toBe(false);
  });
});

describe("nextWindowStart (primeiro início 9h/14h de dia útil, estritamente depois)", () => {
  it("antes das 9h -> hoje 09:00; 10h -> 14:00; 12-14h -> 14:00; após 14h -> amanhã 09:00", () => {
    expect(nextWindowStart(SP, d("2026-06-10T11:59:00Z")).toISOString()).toBe("2026-06-10T12:00:00.000Z");
    expect(nextWindowStart(SP, d("2026-06-10T13:00:00Z")).toISOString()).toBe("2026-06-10T17:00:00.000Z");
    expect(nextWindowStart(SP, d("2026-06-10T15:30:00Z")).toISOString()).toBe("2026-06-10T17:00:00.000Z");
    expect(nextWindowStart(SP, d("2026-06-10T17:00:00Z")).toISOString()).toBe("2026-06-11T12:00:00.000Z");
    expect(nextWindowStart(SP, d("2026-06-10T21:00:00Z")).toISOString()).toBe("2026-06-11T12:00:00.000Z");
  });
  it("sexta à tarde e fim de semana -> segunda 09:00", () => {
    expect(nextWindowStart(SP, d("2026-06-12T21:00:00Z")).toISOString()).toBe("2026-06-15T12:00:00.000Z");
    expect(nextWindowStart(SP, d("2026-06-13T15:00:00Z")).toISOString()).toBe("2026-06-15T12:00:00.000Z");
  });
  it("pula feriado: sexta 4/set -> terça 8/set (7/set é feriado) ", () => {
    expect(nextWindowStart(SP, d("2026-09-04T21:00:00Z")).toISOString()).toBe("2026-09-08T12:00:00.000Z");
  });
  it("virada de dia e de mês/ano (31/dez/2026 quinta -> 1/jan feriado, sexta 2/jan)", () => {
    expect(nextWindowStart(SP, d("2026-06-30T20:00:00Z")).toISOString()).toBe("2026-07-01T12:00:00.000Z");
    expect(nextWindowStart(SP, d("2026-12-31T20:00:00Z")).toISOString()).toBe("2027-01-04T12:00:00.000Z"); // 1/jan feriado (sexta), 2-3/jan fim de semana
  });
  it("DST NY: início (8/mar) e fim (1/nov) de horário de verão", () => {
    // sexta 6/mar 20:00 EST -> segunda 9/mar 09:00 EDT = 13:00Z
    expect(nextWindowStart("America/New_York", d("2026-03-07T01:00:00Z")).toISOString()).toBe("2026-03-09T13:00:00.000Z");
    // sexta 30/out 20:00 EDT -> 1/nov domingo, 2/nov segunda é Finados (feriado BR) -> terça 3/nov 09:00 EST = 14:00Z
    expect(nextWindowStart("America/New_York", d("2026-10-31T00:00:00Z")).toISOString()).toBe("2026-11-03T14:00:00.000Z");
  });
  it("earliestInWindow mantém instante dentro da janela e move o de fora", () => {
    const inside = d("2026-06-10T13:00:00Z");
    expect(earliestInWindow(SP, inside)).toBe(inside);
    expect(earliestInWindow(SP, d("2026-06-10T22:00:00Z")).toISOString()).toBe("2026-06-11T12:00:00.000Z");
  });
});

describe("startOfLocalDay", () => {
  it("dia civil local (SP e Tóquio)", () => {
    expect(startOfLocalDay(SP, d("2026-06-10T13:00:00Z")).toISOString()).toBe("2026-06-10T03:00:00.000Z");
    expect(startOfNextLocalDay(SP, d("2026-06-10T13:00:00Z")).toISOString()).toBe("2026-06-11T03:00:00.000Z");
    expect(startOfLocalDay("Asia/Tokyo", d("2026-06-10T13:00:00Z")).toISOString()).toBe("2026-06-09T15:00:00.000Z");
  });
});
