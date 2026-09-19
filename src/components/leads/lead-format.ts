export type RawParams = Record<string, string | string[] | undefined>;

export const LEAD_FILTER_KEYS = ["q", "campaignId", "stage", "channel", "scoreMin", "scoreMax"] as const;

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** Monta query string a partir de parâmetros crus; ignora vazios; ordem estável. */
export function buildLeadsQuery(params: RawParams, overrides: Record<string, string | number | null | undefined> = {}): string {
  const merged: Record<string, string | undefined> = {};
  for (const k of [...LEAD_FILTER_KEYS, "sort", "dir", "page", "pageSize"]) merged[k] = first(params[k]);
  for (const [k, v] of Object.entries(overrides)) merged[k] = v == null ? undefined : String(v);
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v !== undefined && v.trim() !== "") sp.set(k, v.trim());
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export type SortKey = "score" | "name" | "createdAt";

/** Próxima ordenação ao clicar no cabeçalho: alterna direção se já ativo; padrão asc p/ nome, desc p/ demais. */
export function nextSort(current: { sort: SortKey; dir: "asc" | "desc" }, key: SortKey): { sort: SortKey; dir: "asc" | "desc" } {
  if (current.sort === key) return { sort: key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { sort: key, dir: key === "name" ? "asc" : "desc" };
}

export function ariaSort(current: { sort: SortKey; dir: "asc" | "desc" }, key: SortKey): "ascending" | "descending" | "none" {
  if (current.sort !== key) return "none";
  return current.dir === "asc" ? "ascending" : "descending";
}

/** Máscara progressiva de celular BR: (11) 91234-5678. Remove prefixo 55 quando há 13 dígitos. */
export function maskBrPhone(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+") && d.startsWith("55") && d.length > 11) d = d.slice(2);
  else if (d.length === 13 && d.startsWith("55")) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** E.164 (+5511912345678) -> máscara de exibição; devolve original se não casar. */
export function formatPhone(e164: string | null): string {
  if (!e164) return "";
  return /^\+55\d{11}$/.test(e164) ? maskBrPhone(e164) : e164;
}

const dtf = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const df = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });
export const formatDateTime = (d: Date): string => dtf.format(d);
export const formatDate = (d: Date): string => df.format(d);

/** "há 3 dias", "em 2 horas", "agora". */
export function relativeTime(date: Date, now: Date = new Date()): string {
  const diff = date.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [86_400_000 * 30, "month"],
    [86_400_000, "day"],
    [3_600_000, "hour"],
    [60_000, "minute"],
  ];
  if (abs < 60_000) return "agora";
  const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  for (const [ms, unit] of units) {
    if (abs >= ms) return rtf.format(Math.trunc(diff / ms), unit);
  }
  return "agora";
}

export function pageRange(page: number, pageSize: number, total: number): { from: number; to: number } {
  if (total === 0) return { from: 0, to: 0 };
  return { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, total) };
}

/** "Tem WhatsApp": sim / não / não verificado (com data da verificação quando houver). */
export function whatsappStatusText(hasWhatsapp: boolean | null | undefined, checkedAt: Date | null | undefined): string {
  if (hasWhatsapp === true || hasWhatsapp === false) {
    const base = hasWhatsapp ? "Sim" : "Não";
    return checkedAt ? `${base} (verificado em ${formatDate(checkedAt)})` : base;
  }
  return "Não verificado";
}
