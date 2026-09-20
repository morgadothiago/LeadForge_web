import { BUDGET_ALERT_RATIO, MICROS_PER_CENT } from "./types";

export type BudgetState = "ok" | "alert" | "exhausted" | "no_budget";

export function budgetState(spentMicros: number, budgetCents: number | null): BudgetState {
  if (budgetCents === null || budgetCents <= 0) return "no_budget";
  const cap = budgetCents * MICROS_PER_CENT;
  if (spentMicros >= cap) return "exhausted";
  return spentMicros >= cap * BUDGET_ALERT_RATIO ? "alert" : "ok";
}

/** Preço em USD por milhão de tokens (entrada/saída); modelo desconhecido usa o mais caro (conservador). */
const PRICES: Record<string, [number, number]> = {
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-4-5": [3, 15],
  "claude-opus-4-5": [5, 25],
};
const FALLBACK: [number, number] = [5, 25];

export function costMicros(model: string, tokensIn: number, tokensOut: number): number {
  const [pi, po] = PRICES[model] ?? FALLBACK;
  return Math.ceil(tokensIn * pi + tokensOut * po);
}

export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
