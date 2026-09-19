import { seededRng } from "@/lib/whatsapp/rate";

/**
 * Spintax `{a|b|c}` (SPEC-017). Não conflita com `{{variavel}}`: placeholders duplos são preservados. Sem aninhamento.
 * Sorteio determinístico por `seed` (leadId + stepId): o mesmo lead/passo sempre recebe a mesma variante.
 */
const TOKEN = /\{\{[^{}]*\}\}|\{([^{}]*)\}/g;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function map(body: string, pick: (options: string[]) => string): string {
  return body.replace(TOKEN, (m, group: string | undefined) => (group === undefined ? m : pick(group.split("|"))));
}

export function expandSpintax(body: string, seed: string): string {
  const rng = seededRng(fnv1a(seed));
  return map(body, (opts) => opts[Math.floor(rng() * opts.length)]);
}

/** Variante mais longa (para validar tamanho no pior caso). */
export function longestSpintax(body: string): string {
  return map(body, (opts) => opts.reduce((a, b) => (b.length > a.length ? b : a)));
}

/** Mensagem PT-BR para sintaxe inválida (chaves desbalanceadas, grupo vazio, opção vazia); null se OK. */
export function validateSpintax(body: string): string | null {
  const rest = body.replace(/\{\{[^{}]*\}\}/g, "");
  let open = false;
  let cur = "";
  for (const ch of rest) {
    if (ch === "{") {
      if (open) return "Variação de texto inválida: chave { aberta dentro de outro grupo (aninhamento não é permitido).";
      open = true; cur = "";
    } else if (ch === "}") {
      if (!open) return "Variação de texto inválida: chave } sem a { correspondente.";
      if (cur.trim() === "") return "Variação de texto inválida: grupo {} vazio.";
      if (cur.split("|").some((o) => o.trim() === "")) return "Variação de texto inválida: há uma opção vazia em {a|b|c}.";
      open = false;
    } else if (open) cur += ch;
  }
  if (open) return "Variação de texto inválida: chave { não foi fechada.";
  return null;
}
