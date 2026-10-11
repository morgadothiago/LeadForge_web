import { describe, expect, it } from "vitest";
import type { SubscriptionStatus } from "@prisma/client";
import { cancelModeFor, type CancelMode } from "./cancel-mode";

const NOW = new Date("2026-10-10T12:00:00Z");
const FUTURE = new Date("2026-11-01T00:00:00Z");
const PAST = new Date("2026-10-01T00:00:00Z");

/** Tabela unica (SPEC-053 D-053-1/3). Reutilizada (copia) em billing-cancel.test e CancelSubscriptionPanel.test para provar que action e UI concordam. */
export const CANCEL_MODE_CASES: Array<{ name: string; status: SubscriptionStatus; currentPeriodEnd: Date | null; mode: CancelMode }> = [
  { name: "active com periodo vigente", status: "active", currentPeriodEnd: FUTURE, mode: "scheduled" },
  { name: "past_due com periodo vigente", status: "past_due", currentPeriodEnd: FUTURE, mode: "scheduled" },
  { name: "trialing (mesmo com periodo)", status: "trialing", currentPeriodEnd: FUTURE, mode: "immediate" },
  { name: "trialing sem periodo", status: "trialing", currentPeriodEnd: null, mode: "immediate" },
  { name: "active sem periodo", status: "active", currentPeriodEnd: null, mode: "immediate" },
  { name: "active com periodo vencido", status: "active", currentPeriodEnd: PAST, mode: "immediate" },
  { name: "past_due vencido", status: "past_due", currentPeriodEnd: PAST, mode: "immediate" },
  { name: "incomplete", status: "incomplete", currentPeriodEnd: FUTURE, mode: "immediate" },
  { name: "periodo termina exatamente agora", status: "active", currentPeriodEnd: NOW, mode: "immediate" },
];

describe("cancelModeFor (SPEC-053)", () => {
  for (const c of CANCEL_MODE_CASES) {
    it(c.name, () => expect(cancelModeFor(c, NOW)).toBe(c.mode));
  }
});
