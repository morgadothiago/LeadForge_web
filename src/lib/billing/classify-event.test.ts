import { describe, expect, it } from "vitest";
import { classifyBillingEvent, type PriorSubscriptionState } from "./classify-event";
import type { ParsedBillingEvent } from "./provider";

const T0 = new Date("2026-03-01T00:00:00Z");
const T1 = new Date("2026-04-01T00:00:00Z");
const ev = (over: Partial<ParsedBillingEvent> = {}): ParsedBillingEvent => ({
  eventId: "e", type: "subscription.updated", orgId: "o", planKey: "starter", cadence: "monthly", status: "active",
  currentPeriodEnd: T1, cancelAtPeriodEnd: false, externalCustomerId: null, externalSubscriptionId: null, ...over,
});
const prior = (over: Partial<PriorSubscriptionState> = {}): PriorSubscriptionState => ({ status: "active", planId: "p1", cadence: "monthly", currentPeriodEnd: T0, ...over });

describe("classifyBillingEvent (SPEC-052a)", () => {
  it("sem subscription previa + active = activated", () => expect(classifyBillingEvent(null, ev(), "p1")).toBe("activated"));
  it("trialing -> active = activated", () => expect(classifyBillingEvent(prior({ status: "trialing" }), ev(), "p1")).toBe("activated"));
  it("canceled -> active (reativacao) = activated", () => expect(classifyBillingEvent(prior({ status: "canceled" }), ev(), "p1")).toBe("activated"));
  it("active, mesmo plano, periodo avancou = renewed", () => expect(classifyBillingEvent(prior(), ev(), "p1")).toBe("renewed"));
  it("active, periodo anterior nulo = renewed", () => expect(classifyBillingEvent(prior({ currentPeriodEnd: null }), ev(), "p1")).toBe("renewed"));
  it("active, mesmo periodo (reentrega semantica) = noop", () => expect(classifyBillingEvent(prior({ currentPeriodEnd: T1 }), ev(), "p1")).toBe("noop"));
  it("past_due -> active = recovered", () => expect(classifyBillingEvent(prior({ status: "past_due" }), ev(), "p1")).toBe("recovered"));
  it("planId diferente = plan_changed", () => expect(classifyBillingEvent(prior(), ev(), "p2")).toBe("plan_changed"));
  it("cadence diferente = plan_changed", () => expect(classifyBillingEvent(prior(), ev({ cadence: "yearly" }), "p1")).toBe("plan_changed"));
  it("status past_due ou type payment.failed = payment_failed", () => {
    expect(classifyBillingEvent(prior(), ev({ status: "past_due" }), "p1")).toBe("payment_failed");
    expect(classifyBillingEvent(prior(), ev({ type: "payment.failed", status: "past_due" }), "p1")).toBe("payment_failed");
  });
  it("trialing novo = trial_started; trialing ja em trial = noop", () => {
    expect(classifyBillingEvent(null, ev({ status: "trialing" }), "p1")).toBe("trial_started");
    expect(classifyBillingEvent(prior({ status: "trialing" }), ev({ status: "trialing" }), "p1")).toBe("noop");
  });
  it("canceled/incomplete = noop", () => {
    expect(classifyBillingEvent(prior(), ev({ status: "canceled" }), "p1")).toBe("noop");
    expect(classifyBillingEvent(prior(), ev({ status: "incomplete" }), "p1")).toBe("noop");
  });
});
