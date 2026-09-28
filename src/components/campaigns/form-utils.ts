import type { FieldErrors } from "@/lib/actions/result";
import type { IcpInput } from "@/lib/schemas/icp";

/** Mensagem geral (`_form`) do ActionResult; senão a 1a mensagem de qualquer campo; senão `fallback`. */
export function getFormError(errors: FieldErrors | undefined, fallback = "Não foi possível concluir a operação. Tente novamente."): string {
  return errors?._form?.[0] ?? Object.values(errors ?? {}).flat()[0] ?? fallback;
}

/** Mensagens do campo `key` (inclui subchaves como "signals.0"). */
export function fieldError(errors: FieldErrors | undefined, key: string): string | undefined {
  if (!errors) return undefined;
  const msgs = Object.entries(errors)
    .filter(([k]) => k === key || k.startsWith(`${key}.`))
    .flatMap(([, v]) => v);
  return msgs.length ? msgs.join(" ") : undefined;
}

/** Coleta as mensagens de um nó de erro do RHF (FieldError, nó aninhado ou índice de array como "signals.0"). */
function collectMessages(node: unknown): string[] {
  if (!node || typeof node !== "object") return [];
  const out: string[] = [];
  const rec = node as Record<string, unknown>;
  if (typeof rec.message === "string" && rec.message) out.push(rec.message);
  for (const [k, v] of Object.entries(rec)) {
    if (k === "message" || k === "types" || k === "ref") continue;
    if (v && typeof v === "object") out.push(...collectMessages(v));
  }
  return out;
}

/**
 * Mensagem de erro do `formState.errors` do react-hook-form em `path` (ex.: `["icp", "signals"]`).
 * Percorre nós aninhados/índices de array — `errors.icp.signals[0]` (issue de item de lista) também
 * é exibido no campo `icp.signals`, espelhando o prefix-match do `fieldError` legado.
 */
export function rhfErrorAt(errors: unknown, ...path: string[]): string | undefined {
  let cur: unknown = errors;
  for (const seg of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  const msgs = [...new Set(collectMessages(cur))];
  return msgs.length ? msgs.join(" ") : undefined;
}

export interface IcpValues {
  name: string;
  niche: string;
  location: string;
  companySize: string;
  signals: string;
  keywords: string;
  sources: string;
  desiredData: string;
}

export const EMPTY_ICP: IcpValues = {
  name: "",
  niche: "",
  location: "",
  companySize: "",
  signals: "",
  keywords: "",
  sources: "",
  desiredData: "",
};

export const splitList = (s: string): string[] =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export function toIcpInput(v: IcpValues): IcpInput {
  return {
    name: v.name,
    niche: v.niche,
    location: v.location,
    companySize: v.companySize,
    signals: splitList(v.signals),
    keywords: splitList(v.keywords),
    sources: splitList(v.sources),
    desiredData: splitList(v.desiredData),
  };
}

export function icpToValues(i: {
  name: string;
  niche: string;
  location: string | null;
  companySize: string | null;
  signals: string[];
  keywords: string[];
  sources: string[];
  desiredData: string[];
}): IcpValues {
  return {
    name: i.name,
    niche: i.niche,
    location: i.location ?? "",
    companySize: i.companySize ?? "",
    signals: i.signals.join(", "),
    keywords: i.keywords.join(", "),
    sources: i.sources.join(", "),
    desiredData: i.desiredData.join(", "),
  };
}
