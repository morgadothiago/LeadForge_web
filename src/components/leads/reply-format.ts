import { formatDateTime, relativeTime } from "./lead-format";

/** Trunca no limite de caracteres (por code point), com reticências. Sempre texto puro. */
export function truncateInbound(text: string, max = 90): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(clean);
  return chars.length <= max ? clean : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/** "Respondeu há 2 horas" + data absoluta para o <time>. */
export function replyLabel(at: Date, now: Date = new Date()): { relative: string; absolute: string } {
  return { relative: `Respondeu ${relativeTime(at, now)}`, absolute: formatDateTime(at) };
}
