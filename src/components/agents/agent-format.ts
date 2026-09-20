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

export type BudgetInput = { ok: true; cents: number | null } | { ok: false; error: string };
/** Valida o campo de teto (R$). Texto inválido = erro (nunca apaga o teto); vazio só limpa com `clear` explícito. */
export function resolveBudgetInput(text: string, clear = false): BudgetInput {
  if (!text.trim()) return clear ? { ok: true, cents: null } : { ok: false, error: "Informe um valor em reais maior que zero." };
  if (clear) return { ok: false, error: "Desmarque \"Remover teto\" para informar um valor." };
  const c = parseBudgetToCents(text);
  return c === null ? { ok: false, error: "Valor inválido. Use apenas números, ex.: 50 ou 50,50." } : { ok: true, cents: c };
}
/** Agente novo pode ficar sem teto (vazio = sem teto); editar segue resolveBudgetInput. */
export const budgetToInput = (cents: number | null): string => (cents ? String(cents / 100) : "");

export const toggleId = (s: Set<string>, id: string): Set<string> => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; };
export const isEdited = (body: string, original: string): boolean => body.trim() !== original.trim();
export const canApprove = (body: string, pending: boolean, locked = false): boolean => !pending && !locked && body.trim().length > 0;
export const canReject = (reason: string, pending: boolean, locked = false): boolean => !pending && !locked && reason.trim().length > 0;
export const canBulk = (selected: number, pending: boolean): boolean => !pending && selected > 0;
export const bulkSummary = (r: { sent: number; blocked: number; skipped?: number }): string =>
  `${r.sent} enviado(s), ${r.blocked} bloqueado(s) pela política de envio${r.skipped ? `, ${r.skipped} já tratado(s)` : ""}.`;
export const needsAutoConfirm = (role: string, autonomy: string): boolean => role === "closer" && autonomy !== "draft";
export const canConfirmAuto = (c1: boolean, c2: boolean, disclosureEnabled: boolean, pending: boolean): boolean => !pending && c1 && c2 && disclosureEnabled;
/** Desligar o aviso de IA num Closer autônomo faz o backend voltar a autonomia para rascunho. */
export const disclosureOffDowngrades = (role: string, autonomy: string, disclosure: boolean): boolean => role === "closer" && autonomy !== "draft" && !disclosure;
export const guardrailsLabel = (g: unknown): string => (Array.isArray(g) && g.length ? g.join(", ") : "");
