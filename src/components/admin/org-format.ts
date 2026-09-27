import type { OrgStatus, SubscriptionStatus } from "@prisma/client";

/** SPEC-032 — formatação/labels PT-BR da área "Administração" (`platform_admin`, cross-tenant). */

export type RawParams = Record<string, string | string[] | undefined>;

export const ORG_STATUS_LABELS: Record<OrgStatus, string> = {
  active: "Ativa",
  suspended: "Suspensa",
  cancelled: "Cancelada",
};

/** Mesmo padrão `var(--org-*)` + `color-mix` de `StatusBadge` (`components/domain`) — consistência
 * visual entre os dois badges de status do app, e valor recalculado por tema (SPEC-037, correção
 * QA: antes era hex literal, nunca lia o token CSS de modo ativo). */
export const ORG_STATUS_COLORS: Record<OrgStatus, string> = {
  active: "var(--org-active)",
  suspended: "var(--org-suspended)",
  cancelled: "var(--org-cancelled)",
};

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: "Em teste",
  active: "Ativa",
  past_due: "Pagamento pendente",
  canceled: "Cancelada",
  incomplete: "Incompleta",
};

const ORG_LIST_KEYS = ["q", "status"] as const;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** Monta a query string da lista de organizações; ignora vazios; ordem estável (mesmo padrão de `buildLeadsQuery`). */
export function buildOrgsQuery(params: RawParams, overrides: Record<string, string | number | null | undefined> = {}): string {
  const merged: Record<string, string | undefined> = {};
  for (const k of [...ORG_LIST_KEYS, "page"]) merged[k] = first(params[k]);
  for (const [k, v] of Object.entries(overrides)) merged[k] = v == null ? undefined : String(v);
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v !== undefined && v.trim() !== "") sp.set(k, v.trim());
  const s = sp.toString();
  return s ? `?${s}` : "";
}
