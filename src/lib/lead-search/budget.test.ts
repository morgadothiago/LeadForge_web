import { describe, expect, it } from "vitest";
import { computeBudget, spentCalls } from "./budget";

const L = { daily: 3, manual: 2, org: 10 };

describe("SPEC-058 budget (contagem unica reserve/painel)", () => {
  it("run running conta no minimo 1; blocked conta 0", () => {
    expect(spentCalls([{ status: "running", requests: 0 }, { status: "blocked", requests: 0 }, { status: "done", requests: 1 }])).toBe(2);
  });
  it("manual e diaria separados; org soma as duas", () => {
    const c = [
      { trigger: "manual", status: "done", requests: 1 },
      { trigger: "scheduled", status: "done", requests: 1 },
      { trigger: "manual", status: "running", requests: 0 },
    ];
    const b = computeBudget(c, [...c, { trigger: "scheduled", status: "done", requests: 1 }], L);
    expect(b).toMatchObject({ manualUsed: 2, scheduledUsed: 1, usedToday: 3, remainingManual: 0, orgUsed: 4, remainingOrg: 6, estimatedPaidCallsLeft: 0 });
  });
  it("estimativa e o minimo entre manual e org", () => {
    const b = computeBudget([], Array.from({ length: 9 }, () => ({ trigger: "scheduled", status: "done", requests: 1 })), L);
    expect(b).toMatchObject({ remainingManual: 2, remainingOrg: 1, estimatedPaidCallsLeft: 1 });
  });
});
