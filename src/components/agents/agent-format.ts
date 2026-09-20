export const ROLE_LABELS = { sdr: "SDR (1º toque)", followup: "Follow-up", closer: "Closer" } as const;
export const AUTONOMY_LABELS = { draft: "Rascunho (aprovo tudo)", sampled: "Amostragem", auto: "Automático" } as const;
export const RUN_STATUS_LABELS: Record<string, string> = { queued: "Na fila", done: "Concluída", blocked: "Bloqueada", error: "Erro", skipped: "Ignorada" };

export type UsageLevel = "ok" | "warn" | "stop" | "none";

/** Alerta em 80%, pausa em 100% (espelha budgetState do backend; só apresentação). */
export function usageLevel(spentCents: number, budgetCents: number | null): UsageLevel {
  if (!budgetCents || budgetCents <= 0) return "none";
  const pct = (spentCents / budgetCents) * 100;
  return pct >= 100 ? "stop" : pct >= 80 ? "warn" : "ok";
}
export function usagePercent(spentCents: number, budgetCents: number | null): number {
  if (!budgetCents || budgetCents <= 0) return 0;
  return Math.min(100, Math.round((spentCents / budgetCents) * 100));
}
export const formatBRLCents = (c: number): string => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
/** Custo de execução vem em micro-USD. */
export const formatMicroUsd = (m: number): string => `US$ ${(m / 1_000_000).toFixed(4)}`;
export const parseLines = (s: string): string[] => s.split("\n").map((x) => x.trim()).filter(Boolean);
export const parseBudgetToCents = (s: string): number | null => {
  const n = Number(s.replace(",", "."));
  return s.trim() && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};
