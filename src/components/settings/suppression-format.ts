import type { SuppressionReason } from "@prisma/client";
import { formatPhone } from "@/components/leads/lead-format";

export const SUPPRESSION_REASON_LABELS: Record<SuppressionReason, string> = {
  opt_out_reply: "Pediu para parar (resposta)",
  opt_out_link: "Descadastro por link",
  opt_out_manual: "Opt-out registrado manualmente",
  possible_opt_out_confirmed: "Possível opt-out confirmado",
  bounce: "E-mail inválido (bounce)",
  manual: "Inclusão manual",
};

export const MANUAL_REASONS = ["opt_out_manual", "manual", "bounce"] as const;
export type ManualReason = (typeof MANUAL_REASONS)[number];

export const suppressionReasonLabel = (r: string): string => SUPPRESSION_REASON_LABELS[r as SuppressionReason] ?? r;
export const SUPPRESSION_KIND_LABELS = { phone: "Telefone", email: "E-mail" } as const;

/** Mascara o contato para exibição padrão: e-mail "jo***@dominio.com"; telefone "(11) 9****-5678". */
export function maskSuppressedValue(kind: "phone" | "email", value: string): string {
  if (kind === "email") {
    const at = value.lastIndexOf("@");
    if (at < 1) return "***";
    return `${value.slice(0, Math.min(2, at))}***${value.slice(at)}`;
  }
  const d = value.replace(/\D/g, "");
  const nat = d.startsWith("55") && d.length > 11 ? d.slice(2) : d;
  if (nat.length < 8) return "****";
  return `(${nat.slice(0, 2)}) ${nat.slice(2, 3)}****-${nat.slice(-4)}`;
}

/** Valor completo para exibição após clicar em revelar. */
export const revealSuppressedValue = (kind: "phone" | "email", value: string): string => (kind === "phone" ? formatPhone(value) : value);

export interface SuppressionFilterParams {
  kind?: "phone" | "email";
  q?: string;
  page: number;
}

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** Lê filtros de searchParams: tipo inválido é ignorado; página mínima 1. */
export function parseSuppressionParams(raw: Record<string, string | string[] | undefined>): SuppressionFilterParams {
  const kind = one(raw.kind);
  const q = one(raw.q)?.trim();
  const page = Number.parseInt(one(raw.page) ?? "1", 10);
  return {
    ...(kind === "phone" || kind === "email" ? { kind } : {}),
    ...(q ? { q: q.slice(0, 100) } : {}),
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  };
}

/** Query string estável com overrides; omite vazios e page=1. */
export function buildSuppressionQuery(p: SuppressionFilterParams, overrides: { page?: number } = {}): string {
  const page = overrides.page ?? p.page;
  const sp = new URLSearchParams();
  if (p.kind) sp.set("kind", p.kind);
  if (p.q) sp.set("q", p.q);
  if (page > 1) sp.set("page", String(page));
  const s = sp.toString();
  return s ? `?${s}` : "";
}
