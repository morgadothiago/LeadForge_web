import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { computeNextTouchAt, decideAfterSend, decideStage, pickDueLeads, safeDeferAt, DAY_MS, MIN_DEFER_MS, RETRY_BACKOFF_MS, type DueLeadInput } from "./decide";

const NOW = new Date("2026-06-10T13:30:00Z");
const err = new AppError({ code: "upstream", userMessage: "x" });
const ctx = (over = {}) => ({ now: NOW, attempts: 0, needsReview: false, ...over });
const lead = (over: Partial<DueLeadInput> = {}): DueLeadInput => ({
  id: "a", sequenceStatus: "active", nextTouchAt: new Date(NOW.getTime() - 1), optedOutAt: null, repliedAt: null, createdAt: new Date("2026-06-01T00:00:00Z"), campaignStatus: "active", hasSequence: true, ...over,
});

describe("computeNextTouchAt", () => {
  it("início + step.day dias; sem próximo step -> null", () => {
    expect(computeNextTouchAt(NOW, { day: 2 })).toEqual(new Date(NOW.getTime() + 2 * DAY_MS));
    expect(computeNextTouchAt(NOW, { day: 0 })).toEqual(NOW);
    expect(computeNextTouchAt(NOW, null)).toBeNull();
  });
});

describe("pickDueLeads", () => {
  it("só devidos: active vencido (not_started NUNCA dispara sozinho); exclui pausado/paused_manual/optado/respondeu/campanha pausada/sem sequência/futuro", () => {
    const ok = [lead({ id: "1" })];
    const no = [
      lead({ id: "3", nextTouchAt: new Date(NOW.getTime() + 1) }),
      lead({ id: "4", nextTouchAt: null }),
      lead({ id: "5", sequenceStatus: "paused_replied" }),
      lead({ id: "6", sequenceStatus: "opted_out" }),
      lead({ id: "7", sequenceStatus: "completed" }),
      lead({ id: "8", optedOutAt: NOW }),
      lead({ id: "9", repliedAt: NOW }),
      lead({ id: "10", campaignStatus: "paused" }),
      lead({ id: "11", hasSequence: false }),
      lead({ id: "12", sequenceStatus: "not_started", nextTouchAt: null }),
      lead({ id: "13", sequenceStatus: "not_started" }),
      lead({ id: "14", sequenceStatus: "paused_manual" }),
    ];
    expect(pickDueLeads([...no, ...ok], NOW).map((l) => l.id).sort()).toEqual(["1"]);
  });
  it("tempo injetado e teto; ordem estável", () => {
    const l = [lead({ id: "b", nextTouchAt: new Date(NOW.getTime() + 10) }), lead({ id: "a", nextTouchAt: new Date(NOW.getTime() + 10) })];
    expect(pickDueLeads(l, NOW)).toHaveLength(0);
    const later = new Date(NOW.getTime() + 20);
    expect(pickDueLeads(l, later).map((x) => x.id)).toEqual(["a", "b"]);
    expect(pickDueLeads(l, later, 1)).toHaveLength(1);
  });
});

describe("decideAfterSend", () => {
  it("sent avança; already_sent noop", () => {
    expect(decideAfterSend({ status: "sent", externalId: "x", instanceId: "i" }, ctx())).toEqual({ kind: "advance", outcome: "sent" });
    expect(decideAfterSend({ status: "already_sent" }, ctx())).toEqual({ kind: "noop" });
  });
  it("deferred: mantém no instante; nunca <= agora (sem laço)", () => {
    const at = new Date(NOW.getTime() + 3600_000);
    expect(decideAfterSend({ status: "deferred", nextAt: at, reason: "outside_window" }, ctx())).toEqual({ kind: "defer", nextAt: at });
    expect(decideAfterSend({ status: "deferred", nextAt: NOW }, ctx())).toEqual({ kind: "defer", nextAt: new Date(NOW.getTime() + MIN_DEFER_MS) });
    expect(safeDeferAt(new Date(NOW.getTime() - 5), NOW).getTime()).toBeGreaterThan(NOW.getTime());
  });
  it.each([
    ["opted_out", { kind: "end", status: "opted_out" }],
    ["replied", { kind: "end", status: "paused_replied" }],
    ["sequence_completed", { kind: "end", status: "completed" }],
    ["suppressed", { kind: "end", status: "suppressed" }],
    ["no_whatsapp", { kind: "advance", outcome: "skipped_step" }],
    ["touch_limit", { kind: "advance", outcome: "skipped_step" }],
  ] as const)("skipped %s", (reason, expected) => {
    expect(decideAfterSend({ status: "skipped", reason }, ctx())).toEqual(expected);
  });
  it("failed: retry 30 min / 2 h / 6 h; esgotado avança; timeout não reenvia", () => {
    const f = { status: "failed", error: err } as const;
    for (let i = 0; i < 3; i++) {
      expect(decideAfterSend(f, ctx({ attempts: i }))).toEqual({ kind: "retry", attempts: i + 1, at: new Date(NOW.getTime() + RETRY_BACKOFF_MS[i]) });
    }
    expect(RETRY_BACKOFF_MS).toEqual([30 * 60_000, 2 * 3600_000, 6 * 3600_000]);
    expect(decideAfterSend(f, ctx({ attempts: 3 }))).toEqual({ kind: "advance", outcome: "failed_final" });
    expect(decideAfterSend(f, ctx({ attempts: 0, needsReview: true }))).toEqual({ kind: "advance", outcome: "timeout_no_retry" });
  });
});

describe("decideStage (forward-only)", () => {
  it("1º envio -> contactado; seguintes -> em_followup; nunca regride nem toca estágios adiante/fechado/perdido", () => {
    expect(decideStage("novo_lead", 1)).toBe("contactado");
    expect(decideStage("contactado", 2)).toBe("em_followup");
    expect(decideStage("novo_lead", 2)).toBe("em_followup");
    expect(decideStage("contactado", 1)).toBeNull();
    expect(decideStage("em_followup", 5)).toBeNull();
    for (const s of ["interessado", "reuniao_agendada", "fechado", "perdido"] as const) expect(decideStage(s, 3)).toBeNull();
  });
});
