import { describe, expect, it } from "vitest";
import { layoutLanes } from "./layout";
import { timeOptions, toPayload, validate, valuesFromMeeting, initialValues } from "./form";

describe("layoutLanes", () => {
  it("sem sobreposicao: 1 lane; sobrepostos lado a lado; encostar nao sobrepoe", () => {
    expect(layoutLanes([{ startMin: 60, endMin: 120 }, { startMin: 120, endMin: 180 }])).toEqual([{ lane: 0, lanes: 1 }, { lane: 0, lanes: 1 }]);
    expect(layoutLanes([{ startMin: 60, endMin: 120 }, { startMin: 90, endMin: 150 }])).toEqual([{ lane: 0, lanes: 2 }, { lane: 1, lanes: 2 }]);
  });
  it("mantem a ordem da entrada", () => {
    const r = layoutLanes([{ startMin: 90, endMin: 150 }, { startMin: 60, endMin: 120 }]);
    expect(r).toEqual([{ lane: 1, lanes: 2 }, { lane: 0, lanes: 2 }]);
  });
});

describe("form do dialog", () => {
  it("opcoes de 15 em 15 min e horario fora da grade preservado", () => {
    expect(timeOptions(0, 60)).toEqual([0, 15, 30, 45, 60]);
    expect(timeOptions(0, 60, 40)).toEqual([0, 15, 30, 40, 45, 60]);
  });
  it("payload usa o fuso escolhido (SP -03:00) e calcula duracao", () => {
    const p = toPayload({ ...initialValues("2026-10-01"), startMin: 14 * 60, endMin: 14 * 60 + 45 });
    expect(p.startsAt).toBe("2026-10-01T17:00:00.000Z");
    expect(p.durationMin).toBe(45);
    expect(p.endsAt.toISOString()).toBe("2026-10-01T17:45:00.000Z");
  });
  it("valores da reuniao existente no fuso dela", () => {
    const v = valuesFromMeeting({ startsAt: new Date("2026-10-01T02:30:00Z"), endsAt: new Date("2026-10-01T03:00:00Z"), durationMin: 30, timezone: "America/Sao_Paulo", link: null, notes: null, opportunityId: "o" });
    expect(v).toMatchObject({ dateKey: "2026-09-30", startMin: 1410, endMin: 1440 });
  });
  it("validacao em PT-BR", () => {
    expect(validate(initialValues("2026-10-01"), "create").opportunityId).toMatch(/Selecione/);
    expect(validate(initialValues("2026-10-01"), "edit")).toEqual({});
    expect(validate({ ...initialValues("2026-10-01"), endMin: 600 }, "edit").endMin).toMatch(/depois do início/);
    expect(validate({ ...initialValues("2026-10-01"), link: "http://x" }, "edit").link).toMatch(/https/);
  });
});
