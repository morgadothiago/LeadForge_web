import type { FieldPath, FieldValues, UseFormSetError, UseFormSetFocus } from "react-hook-form";
import type { FieldErrors } from "@/lib/actions/result";
import { getFormError } from "@/components/campaigns/form-utils";

/** SPEC-049b — helpers puros de formatação/estado da UI de organizações e equipe. */

export type OrgRoleName = "owner" | "member";

export const ROLE_LABEL: Record<OrgRoleName, string> = { owner: "Proprietário", member: "Membro" };

export function roleLabel(role: OrgRoleName): string {
  return ROLE_LABEL[role];
}

export const ORG_STATUS_LABEL: Record<string, string> = {
  active: "Ativa",
  suspended: "Suspensa",
  cancelled: "Cancelada",
};

export function orgStatusLabel(status: string): string {
  return ORG_STATUS_LABEL[status] ?? status;
}

/** Normaliza para busca: minúsculas, sem acento, espaços aparados. */
export function normalizeSearch(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/** Filtra organizações por nome (case/acento-insensitive); consulta vazia devolve a lista inteira. */
export function filterOrganizations<T extends { name: string }>(orgs: readonly T[], query: string): T[] {
  const q = normalizeSearch(query);
  if (!q) return [...orgs];
  return orgs.filter((o) => normalizeSearch(o.name).includes(q));
}

/** Iniciais (até 2 letras) para o avatar da organização. */
export function orgInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const chars = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? "?").slice(0, 2);
  return chars.toUpperCase();
}

const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });
const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const v = d instanceof Date ? d : new Date(d);
  return Number.isNaN(v.getTime()) ? "—" : dateFmt.format(v);
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const v = d instanceof Date ? d : new Date(d);
  return Number.isNaN(v.getTime()) ? "—" : dateTimeFmt.format(v);
}

export interface JoinCodeLike {
  expiresAt: Date | string | null;
  maxUses: number | null;
  uses: number;
  expired: boolean;
  exhausted: boolean;
}

/** Estado do código de entrada para a UI: `active` só se não expirou e ainda tem usos. */
export function joinCodeState(c: JoinCodeLike): "active" | "expired" | "exhausted" {
  if (c.expired) return "expired";
  if (c.exhausted) return "exhausted";
  return "active";
}

export function joinCodeSummary(c: JoinCodeLike): string {
  const uses = c.maxUses === null ? `${c.uses} usos` : `${c.uses} de ${c.maxUses} usos`;
  return `${uses} · expira em ${formatDate(c.expiresAt)}`;
}

/** Caminho interno seguro para `?next=` (evita open redirect); só aceita "/algo" sem "//" ou esquema. */
export function safeInternalPath(p: string | null | undefined, fallback = "/dashboard"): string {
  if (!p || !p.startsWith("/") || p.startsWith("//") || p.includes("\\")) return fallback;
  return p;
}

/** Quantidade de owners — usada para desabilitar rebaixar/remover o último owner na UI (o servidor é a barreira real). */
export function countOwners(members: { orgRole: OrgRoleName }[]): number {
  return members.filter((m) => m.orgRole === "owner").length;
}

/**
 * Aplica `ActionResult.errors` em um form RHF (padrão SPEC-042): `_form` -> `root`; campos conhecidos -> `setError`
 * + foco no primeiro. Chaves desconhecidas (que não existem no form) caem em `root` para nunca sumirem.
 * Retorna a mensagem geral para o toast.
 */
export function applyServerErrors<T extends FieldValues>(
  errors: FieldErrors,
  setError: UseFormSetError<T>,
  setFocus: UseFormSetFocus<T>,
  knownFields: readonly string[],
): string {
  const rootMsgs: string[] = [...(errors._form ?? [])];
  let first: string | undefined;
  for (const [key, msgs] of Object.entries(errors)) {
    if (key === "_form") continue;
    if (knownFields.includes(key)) {
      first ??= key;
      setError(key as FieldPath<T>, { type: "server", message: msgs.join(" ") });
    } else rootMsgs.push(...msgs);
  }
  if (rootMsgs.length) setError("root", { type: "server", message: rootMsgs.join(" ") });
  if (first) setFocus(first as FieldPath<T>);
  return getFormError(errors);
}

export type JoinInput = { kind: "token"; token: string } | { kind: "code"; code: string };

/**
 * Interpreta o campo único do signup: link `.../convite/<token>` (ou só o token de convite colado como link) vira
 * `token`; qualquer outra coisa é tratada como código de entrada (o servidor normaliza/valida).
 */
export function parseJoinInput(raw: string): JoinInput {
  const v = raw.trim();
  const m = /\/convite\/([^/?#\s]+)/.exec(v);
  if (m) {
    try {
      return { kind: "token", token: decodeURIComponent(m[1]) };
    } catch {
      return { kind: "token", token: m[1] };
    }
  }
  return { kind: "code", code: v };
}

/** Mascara o e-mail para exibir a quem so tem o link (ex.: "o***a@empresa.com"): o dominio fica, o usuario some quase todo. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  const user = email.slice(0, at);
  const masked = user.length <= 2 ? `${user[0]}***` : `${user[0]}***${user[user.length - 1]}`;
  return `${masked}${email.slice(at)}`;
}
