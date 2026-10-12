/**
 * SPEC-063 (D-063-23) — log diagnosticavel dos erros HTTP do AbacatePay SEM segredos/PII.
 * Funcoes puras (testadas em `abacatepay-errors.test.ts`). Nunca recebem nem imprimem o corpo da REQUISICAO nem headers:
 * so metodo, PATH SEM QUERY, status e o corpo da RESPOSTA de erro, mascarado e truncado.
 */

export const MAX_ERROR_BODY_CHARS = 500;
const MASK = "[REDACTED]";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const WEBHOOK_SECRET_QS = /webhookSecret=[^&\s"']+/gi;
// taxId/cpf/cnpj como chave JSON ou texto ("taxId":"123.456.789-00", taxId: 123...).
const TAX_KEY_VALUE = /("?(?:taxId|cpf|cnpj)"?\s*[:=]\s*)("[^"]*"|[0-9.*\-/]+)/gi;
// CPF/CNPJ soltos (com ou sem pontuacao) e a forma mascarada da doc ("12.***.***/0001-**").
const CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;

/** Mascara segredos conhecidos (valores literais de env) e padroes sensiveis. Valores curtos (<8) nao sao tratados como segredo (evita mascarar texto comum). */
export function maskSensitive(text: string, secrets: ReadonlyArray<string | undefined | null> = []): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 8) out = out.split(s).join(MASK);
  }
  return out
    .replace(BEARER, `Bearer ${MASK}`)
    .replace(WEBHOOK_SECRET_QS, `webhookSecret=${MASK}`)
    .replace(TAX_KEY_VALUE, (_m, k: string) => `${k}"${MASK}"`)
    .replace(EMAIL, MASK)
    .replace(CNPJ, MASK)
    .replace(CPF, MASK);
}

/** Path sem query string e sem host (so o que identifica o endpoint). */
export function pathOnly(urlOrPath: string | undefined): string {
  if (!urlOrPath) return "";
  const noQuery = urlOrPath.split("?")[0] ?? "";
  try {
    return new URL(noQuery, "http://placeholder.local").pathname;
  } catch {
    return "[path]";
  }
}

export interface UpstreamErrorInput {
  method: string;
  url: string | undefined;
  status: number | undefined;
  /** Corpo da RESPOSTA (string ou objeto ja parseado). */
  body: unknown;
  secrets?: ReadonlyArray<string | undefined | null>;
}

export function describeUpstreamError(i: UpstreamErrorInput): string {
  let raw: string;
  if (typeof i.body === "string") raw = i.body;
  else {
    try {
      raw = JSON.stringify(i.body ?? "");
    } catch {
      raw = "[corpo ilegivel]";
    }
  }
  // Mascara ANTES de truncar (um segredo cortado no meio escaparia do replace).
  const masked = maskSensitive(raw, i.secrets).slice(0, MAX_ERROR_BODY_CHARS);
  return `[abacatepay] ${i.method.toUpperCase()} ${pathOnly(i.url)} -> ${i.status ?? "sem-resposta"} ${masked}`;
}
