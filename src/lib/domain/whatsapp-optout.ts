/**
 * Classificação de respostas de WhatsApp (SPEC-012, D18). Puro e testado.
 * - opt_out: texto INTEIRO normalizado igual a um item de OPT_OUT_EXACT (mensagem curta exata).
 * - possible_opt_out: frase com padrão forte de recusa (não move para perdido; só alerta).
 * - reply: qualquer outra resposta.
 */

/** Itens já normalizados (minúsculas, sem acento/pontuação). */
export const OPT_OUT_EXACT: readonly string[] = [
  "parar", "pare", "sair", "cancelar", "remover", "descadastrar", "stop", "nao quero", "nao quero mais", "nao tenho interesse",
];

/** Padrões fortes de recusa (já normalizados), casados por palavras inteiras dentro do texto. */
export const POSSIBLE_OPT_OUT_PATTERNS: readonly string[] = [
  "para de me mandar", "para de me enviar", "nao me envie", "nao me envie mais", "me tira da lista", "me tire da lista",
  "remover meu numero", "remova meu numero", "nao tenho interesse em receber", "nao me mande mais",
];

export type InboundClass = "opt_out" | "possible_opt_out" | "reply";

/** minúsculas, sem acento, sem pontuação/emoji, trim, espaços colapsados. */
export function normalizeInboundText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function classifyInboundText(text: string): InboundClass {
  const n = normalizeInboundText(text);
  if (!n) return "reply";
  if (OPT_OUT_EXACT.includes(n)) return "opt_out";
  const padded = ` ${n} `;
  if (POSSIBLE_OPT_OUT_PATTERNS.some((p) => padded.includes(` ${p} `))) return "possible_opt_out";
  return "reply";
}
