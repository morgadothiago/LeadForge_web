import { describe, expect, it } from "vitest";
import { ALERT_KINDS } from "@/lib/mobile/alerts";
import { AREAS, KIND_AREA, areaOfKind, isArea, kindsOfArea, summarizeByKind } from "./areas";

describe("mapa kind -> area (SPEC-028)", () => {
  it("todos os kinds emitidos (TEXT) tem area", () => {
    expect(ALERT_KINDS).toContain("meeting_reminder");
    for (const k of ALERT_KINDS) expect(areaOfKind(k), k).not.toBeNull();
  });
  it("mapeamento da SPEC", () => {
    expect(areaOfKind("meeting_reminder")).toBe("calendario");
    expect(["handoff", "lead_replied"].map(areaOfKind)).toEqual(["leads", "leads"]);
    for (const k of ["wa_disconnected", "wa_paused", "scheduler_stale", "budget_alert", "budget_exhausted", "mass_opt_out"]) expect(areaOfKind(k)).toBe("configuracoes");
    expect(areaOfKind("kind_novo_xyz")).toBeNull();
    expect(areaOfKind("__proto__")).toBeNull();
    expect(areaOfKind("toString")).toBeNull();
  });
  it("kindsOfArea/isArea", () => {
    expect(kindsOfArea("leads").sort()).toEqual(["handoff", "lead_replied"]);
    expect(kindsOfArea("aprovacoes")).toEqual([]);
    expect(AREAS.every(isArea)).toBe(true);
    expect(isArea("x")).toBe(false);
    expect(Object.values(KIND_AREA).every(isArea)).toBe(true);
  });
  it("kind desconhecido conta so no total", () => {
    const s = summarizeByKind([{ kind: "meeting_reminder", count: 2 }, { kind: "handoff", count: 1 }, { kind: "wa_paused", count: 3 }, { kind: "novo_kind", count: 4 }]);
    expect(s).toEqual({ unreadTotal: 10, byArea: { calendario: 2, leads: 1, configuracoes: 3 } });
  });
});
