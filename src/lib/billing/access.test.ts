// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { SubscriptionStatus } from "@prisma/client";
import { resolveOrgAccess, trialDaysLeft, type AccessSubscription } from "./access";

const DAY = 24 * 3600_000;
const T0 = new Date("2026-11-01T12:00:00Z");
const at = (days: number) => new Date(T0.getTime() + days * DAY);
const trial = (over: Partial<AccessSubscription> = {}): AccessSubscription => ({ status: "trialing", pastDueSince: null, trialEndsAt: at(14), ...over });
const active = { status: "active" as const };
const suspended = { status: "suspended" as const };

describe("resolveOrgAccess (SPEC-065, D-065-12) — por tabela, com relogio injetado", () => {
  it("trial de 14 dias: D0, D+10 (ativo), D+11 e D+13 (expirando), D+14 (expirado), D+15 (expirado)", () => {
    const sub = trial();
    expect(resolveOrgAccess(sub, active, at(0))).toBe("trial_ativo");
    expect(resolveOrgAccess(sub, active, at(10))).toBe("trial_ativo");
    expect(resolveOrgAccess(sub, active, at(11))).toBe("trial_expirando");
    expect(resolveOrgAccess(sub, active, at(13))).toBe("trial_expirando");
    expect(resolveOrgAccess(sub, active, at(14))).toBe("trial_expirado");
    expect(resolveOrgAccess(sub, active, at(15))).toBe("trial_expirado");
  });
  it("bordas exatas: trialEndsAt = now (expirado), now+3d (expirando), now+3d+1ms (ativo), now+1ms (expirando), null (expirado)", () => {
    expect(resolveOrgAccess(trial({ trialEndsAt: T0 }), active, T0)).toBe("trial_expirado");
    expect(resolveOrgAccess(trial({ trialEndsAt: at(3) }), active, T0)).toBe("trial_expirando");
    expect(resolveOrgAccess(trial({ trialEndsAt: new Date(at(3).getTime() + 1) }), active, T0)).toBe("trial_ativo");
    expect(resolveOrgAccess(trial({ trialEndsAt: new Date(T0.getTime() + 1) }), active, T0)).toBe("trial_expirando");
    expect(resolveOrgAccess(trial({ trialEndsAt: null }), active, T0)).toBe("trial_expirado");
  });
  it("trial expirado e BLOQUEIO TOTAL mesmo com Organization.status ainda `active` (nao depende do tick)", () => {
    expect(resolveOrgAccess(trial({ trialEndsAt: at(-1) }), active, T0)).toBe("trial_expirado");
    expect(resolveOrgAccess(trial({ trialEndsAt: at(-1) }), suspended, T0)).toBe("trial_expirado");
  });
  it("suspensao do admin/cancelada durante o trial vigente => soft_blocked (nao e o bloqueio total)", () => {
    expect(resolveOrgAccess(trial(), suspended, T0)).toBe("soft_blocked");
  });
  it("pago: active => pago; past_due ate 7 dias => pago_em_atraso; depois => soft_blocked", () => {
    expect(resolveOrgAccess({ status: "active", pastDueSince: null, trialEndsAt: null }, active, T0)).toBe("pago");
    const pd = (days: number): AccessSubscription => ({ status: "past_due", pastDueSince: at(-days), trialEndsAt: null });
    expect(resolveOrgAccess(pd(6), active, T0)).toBe("pago_em_atraso");
    expect(resolveOrgAccess(pd(7), active, T0)).toBe("soft_blocked");
    expect(resolveOrgAccess(pd(8), suspended, T0)).toBe("soft_blocked");
  });
  it("cancelado, incomplete e cancelAtPeriodEnd vencido => soft_blocked; cancelAtPeriodEnd vigente => pago", () => {
    for (const status of ["canceled", "incomplete"] as SubscriptionStatus[]) expect(resolveOrgAccess({ status, pastDueSince: null, trialEndsAt: null }, active, T0)).toBe("soft_blocked");
    const sched = (end: Date): AccessSubscription => ({ status: "active", pastDueSince: null, trialEndsAt: null, cancelAtPeriodEnd: true, currentPeriodEnd: end });
    expect(resolveOrgAccess(sched(at(5)), active, T0)).toBe("pago");
    expect(resolveOrgAccess(sched(T0), active, T0)).toBe("soft_blocked");
  });
  it("sem Subscription: ilimitada e sem bloqueio (D-065-25) se a org esta active; org suspensa => soft_blocked", () => {
    expect(resolveOrgAccess(null, active, T0)).toBe("sem_assinatura");
    expect(resolveOrgAccess(null, suspended, T0)).toBe("soft_blocked");
  });
  it("trialDaysLeft arredonda para cima e nunca e negativo", () => {
    expect(trialDaysLeft(at(14), T0)).toBe(14);
    expect(trialDaysLeft(new Date(T0.getTime() + 1), T0)).toBe(1);
    expect(trialDaysLeft(at(-2), T0)).toBe(0);
    expect(trialDaysLeft(null, T0)).toBe(0);
  });
});
