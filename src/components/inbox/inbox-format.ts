/** SPEC-068b: formatacao PURA da caixa (hora, dia, iniciais, links seguros). Relogio sempre por parametro. */

const HM = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const DM = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const DMY = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const dayDiff = (a: Date, now: Date): number => Math.round((startOfDay(now) - startOfDay(a)) / 86_400_000);

export const formatHour = (iso: string): string => HM.format(new Date(iso));

/** Lista: hoje = HH:mm, ontem = "Ontem", antes = dd/MM (outro ano: dd/MM/aaaa). */
export function formatListTime(iso: string, now: Date): string {
  const d = new Date(iso);
  const diff = dayDiff(d, now);
  if (diff <= 0) return HM.format(d);
  if (diff === 1) return "Ontem";
  return d.getFullYear() === now.getFullYear() ? DM.format(d) : DMY.format(d);
}

/** Separador de data do chat: "Hoje", "Ontem", dd/MM/aaaa. */
export function dayLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const diff = dayDiff(d, now);
  if (diff <= 0) return "Hoje";
  if (diff === 1) return "Ontem";
  return DMY.format(d);
}

/** Chave estavel do dia (local) para agrupar bolhas. */
export const dayKey = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const chars = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "?").slice(0, 2);
  return chars.toUpperCase();
}

export type TextSegment = { type: "text"; value: string } | { type: "link"; value: string; href: string };

const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const TRAILING = /[.,;:!?)\]}]+$/;

/**
 * Divide o texto em trechos de texto e links. Link so para http/https (validado com `URL`); `javascript:`, `data:` etc. nunca viram link.
 * O chamador renderiza `value` SEMPRE como texto React (escapado): nunca HTML.
 */
export function linkify(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    let raw = m[0];
    const trail = TRAILING.exec(raw)?.[0] ?? "";
    if (trail) raw = raw.slice(0, raw.length - trail.length);
    let href: string | null = null;
    try {
      const u = new URL(raw);
      if (u.protocol === "http:" || u.protocol === "https:") href = u.toString();
    } catch { /* invalido: fica texto */ }
    if (!href) continue;
    if (start > last) out.push({ type: "text", value: text.slice(last, start) });
    out.push({ type: "link", value: raw, href });
    last = start + raw.length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

/** "ate 14:32" quando a janela fecha hoje em menos de 3 h; senao null. */
export function windowHint(windowClosesAt: string | null, nowMs: number): string | null {
  if (!windowClosesAt) return null;
  const left = Date.parse(windowClosesAt) - nowMs;
  if (left <= 0 || left > 3 * 3600_000) return null;
  return `Você pode responder até ${formatHour(windowClosesAt)} (janela de 24 horas).`;
}
