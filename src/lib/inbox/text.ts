import { PREVIEW_MAX_CHARS } from "./constants";

/** Prévia da última mensagem para a lista: sem tags HTML/controle, espaços colapsados, até 120 caracteres. O front renderiza SEMPRE como texto. */
export function buildPreview(text: string | null | undefined): string | null {
  if (!text) return null;
  const clean = text.replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > PREVIEW_MAX_CHARS ? `${clean.slice(0, PREVIEW_MAX_CHARS - 1)}…` : clean;
}

const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
export const hasControlChars = (s: string): boolean => CONTROL_RE.test(s);

/** Telefone para a UI: mascara o meio (+55 11 9****-7777). Nunca é usado em log. */
export function maskPhone(e164: string): string {
  const d = e164.replace(/\D/g, "");
  if (d.length < 8) return "****";
  return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 5)}****-${d.slice(-4)}`;
}

/** Erro para log da caixa: SÓ nome e código (nunca `message`, que pode carregar trecho de dados/telefone). */
export function inboxErrorForLog(e: unknown): string {
  const o = (e && typeof e === "object" ? e : {}) as { name?: unknown; code?: unknown };
  return [typeof o.name === "string" ? o.name : "Error", typeof o.code === "string" ? `code=${o.code}` : ""].filter(Boolean).join(" ");
}
