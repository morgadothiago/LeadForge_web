import type { Channel } from "@prisma/client";

/** Variáveis permitidas nos templates. Qualquer outra é erro de validação. */
export const TEMPLATE_VARIABLES = ["name", "firstName", "company", "email", "phone", "website"] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type TemplateVars = Partial<Record<TemplateVariable, string | null | undefined>>;

export type RenderResult =
  | { ok: true; text: string; missing: TemplateVariable[] }
  | { ok: false; unknown: string[] };

const PLACEHOLDER = /\{\{\s*([^{}\s]*)\s*\}\}/g;
const ALLOWED: ReadonlySet<string> = new Set(TEMPLATE_VARIABLES);
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Nomes de variáveis usadas (únicos, na ordem), incluindo desconhecidas. */
export function extractVariables(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

const LINE_BREAKS = new RegExp("[\\r\\n" + String.fromCharCode(0x2028, 0x2029) + "]+", "g");

/** Valor de variável: remove caracteres de controle; subject/linha única remove quebras. */
function sanitize(value: string, singleLine: boolean): string {
  const noCtl = value.replace(CONTROL, "");
  return singleLine ? noCtl.replace(LINE_BREAKS, " ").trim() : noCtl.replace(/\r\n?/g, "\n");
}

/**
 * Renderização pura. Passo único (o valor inserido NUNCA é reprocessado: sem injeção de `{{x}}`).
 * - variável desconhecida => { ok:false, unknown } (erro de validação, nada é renderizado);
 * - variável conhecida sem valor (null/undefined/vazio) => "" e listada em `missing`.
 * `field: "subject"` força linha única (sem CR/LF, evita header injection em e-mail).
 * `channel` é aceito para escapes específicos: hoje só e-mail diferencia subject; texto é sempre puro (sem HTML).
 */
export function renderTemplate(
  body: string,
  vars: TemplateVars,
  opts: { channel?: Channel; field?: "subject" | "body" } = {},
): RenderResult {
  const unknown = extractVariables(body).filter((v) => !ALLOWED.has(v));
  if (unknown.length) return { ok: false, unknown };
  const singleLine = opts.field === "subject";
  const missing = new Set<TemplateVariable>();
  const text = body.replace(PLACEHOLDER, (_m, key: string) => {
    const raw = vars[key as TemplateVariable];
    if (raw == null || raw.trim() === "") {
      missing.add(key as TemplateVariable);
      return "";
    }
    return sanitize(raw, singleLine);
  });
  const finalText = singleLine ? sanitize(text, true) : text;
  return { ok: true, text: finalText, missing: [...missing] };
}
