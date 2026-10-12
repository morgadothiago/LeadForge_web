import { describe, expect, it } from "vitest";
import { addCycle } from "./providers/abacatepay-webhook";
import { addCycleFromAnchor, nextDueFromAnchor, snapToAnchor } from "./cycle-anchor";

const iso = (d: Date) => d.toISOString();

describe("addCycleFromAnchor (Q-066-1, sem deriva)", () => {
  it("mensal ancorado no dia 31: clamp no fim do mes e volta ao 31 depois", () => {
    const a = new Date("2026-01-31T15:00:00Z");
    expect([1, 2, 3, 4].map((n) => iso(addCycleFromAnchor(a, n, "monthly")))).toEqual([
      "2026-02-28T15:00:00.000Z", "2026-03-31T15:00:00.000Z", "2026-04-30T15:00:00.000Z", "2026-05-31T15:00:00.000Z",
    ]);
  });
  it("dia 30 e dia 29 em fevereiro comum e bissexto", () => {
    expect(iso(addCycleFromAnchor(new Date("2026-01-30T15:00:00Z"), 1, "monthly"))).toBe("2026-02-28T15:00:00.000Z");
    expect(iso(addCycleFromAnchor(new Date("2026-01-30T15:00:00Z"), 2, "monthly"))).toBe("2026-03-30T15:00:00.000Z");
    expect(iso(addCycleFromAnchor(new Date("2028-01-29T15:00:00Z"), 1, "monthly"))).toBe("2028-02-29T15:00:00.000Z"); // bissexto
    expect(iso(addCycleFromAnchor(new Date("2027-01-29T15:00:00Z"), 1, "monthly"))).toBe("2027-02-28T15:00:00.000Z"); // comum
  });
  it("anual 29/02: 28/02 em ano comum e 29/02 em bissexto", () => {
    const a = new Date("2028-02-29T15:00:00Z");
    expect(iso(addCycleFromAnchor(a, 1, "yearly"))).toBe("2029-02-28T15:00:00.000Z");
    expect(iso(addCycleFromAnchor(a, 2, "yearly"))).toBe("2030-02-28T15:00:00.000Z");
    expect(iso(addCycleFromAnchor(a, 4, "yearly"))).toBe("2032-02-29T15:00:00.000Z");
  });
  it("pagamento 22h SP na borda do mes (01h UTC do dia seguinte) ancora no dia LOCAL de SP", () => {
    const a = new Date("2026-02-01T01:00:00Z"); // 31/01 22h em Sao Paulo
    expect(iso(addCycleFromAnchor(a, 1, "monthly"))).toBe("2026-03-01T01:00:00.000Z"); // 28/02 22h SP
    expect(iso(addCycleFromAnchor(a, 2, "monthly"))).toBe("2026-04-01T01:00:00.000Z"); // 31/03 22h SP
  });
  it("cadeia de 24 renovacoes nao deriva; addCycle encadeado derivaria (prova do bug)", () => {
    const a = new Date("2026-01-31T15:00:00Z");
    let chained = a;
    for (let n = 1; n <= 24; n++) {
      chained = addCycle(chained, "monthly");
      expect(addCycleFromAnchor(a, n, "monthly").getUTCDate()).toBeGreaterThanOrEqual(28);
    }
    expect(chained.getUTCDate()).toBe(28); // deriva
    expect(addCycleFromAnchor(a, 24, "monthly").getUTCDate()).toBe(31);
  });
});

describe("snapToAnchor / nextDueFromAnchor", () => {
  const a = new Date("2026-01-31T15:00:00Z");
  it("corrige a deriva do currentPeriodEnd encadeado (28/03 -> 31/03)", () => {
    let chained = a;
    for (let i = 0; i < 2; i++) chained = addCycle(chained, "monthly"); // 28/03
    expect(iso(chained)).toBe("2026-03-28T15:00:00.000Z");
    expect(iso(snapToAnchor(chained, a, "monthly"))).toBe("2026-03-31T15:00:00.000Z");
    expect(iso(nextDueFromAnchor(chained, a, "monthly"))).toBe("2026-04-30T15:00:00.000Z");
  });
  it("sem ancora ou data fora do ciclo: nao ajusta", () => {
    const d = new Date("2026-03-15T15:00:00Z");
    expect(snapToAnchor(d, null, "monthly")).toBe(d);
    expect(iso(snapToAnchor(d, a, "monthly"))).toBe(iso(d));
    expect(iso(nextDueFromAnchor(d, null, "monthly"))).toBe(iso(addCycle(d, "monthly")));
  });
  it("anual: snap em torno do aniversario", () => {
    const y = new Date("2028-02-29T15:00:00Z");
    expect(iso(snapToAnchor(new Date("2030-03-01T15:00:00Z"), y, "yearly"))).toBe("2030-02-28T15:00:00.000Z");
  });
});
