import { longestSpintax } from "@/lib/templates/spintax";
import { normalizeInboundText } from "@/lib/domain/whatsapp-optout";

export const FIRST_TOUCH_MAX_CHARS = 350;
/** Palavras/expressões promocionais (normalizadas: minúsculas, sem acento). Sobrescreva com env WHATSAPP_PROMO_WORDS (vírgulas). */
export const DEFAULT_PROMO_WORDS: readonly string[] = [
  "promocao", "desconto", "oferta", "gratis", "gratuito", "imperdivel", "urgente", "ultima chance", "aproveite", "garanta", "sorteio", "ganhe", "100%",
];

export function promoWords(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.WHATSAPP_PROMO_WORDS?.trim();
  if (!raw) return [...DEFAULT_PROMO_WORDS];
  return raw.split(",").map((w) => normalizeInboundText(w)).filter(Boolean);
}

const URL_RE = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|com\.br|net|org|io|app|br)\b/i;
const EXIT_RE = /\b(respond\w*|digite|envie|mande|escreva)\b.{0,20}\b(nao|parar|sair|stop)\b|\bse nao (fizer sentido|tiver interesse|for|interessar)|\bnao (quer|quiser|deseja|desejar) receber\b/;

/** Avisos (não bloqueiam) para o 1º toque de WhatsApp: URL, tamanho, palavras promocionais, falta de linha de saída. */
export function validateFirstTouchTemplate(body: string, words: readonly string[] = promoWords()): string[] {
  const text = longestSpintax(body);
  const norm = ` ${normalizeInboundText(text)} `;
  const warnings: string[] = [];
  if (URL_RE.test(text)) warnings.push("O primeiro toque não deve conter link: mensagens com URL para desconhecidos aumentam o risco de denúncia.");
  if (text.length > FIRST_TOUCH_MAX_CHARS) warnings.push(`O primeiro toque tem ${text.length} caracteres; prefira até ${FIRST_TOUCH_MAX_CHARS} (uma pergunta curta).`);
  const hit = words.filter((w) => norm.includes(` ${w} `) || (w.includes("%") && text.toLowerCase().includes(w)));
  if (hit.length) warnings.push(`Palavras promocionais que costumam gerar denúncia: ${hit.join(", ")}.`);
  if (!EXIT_RE.test(norm)) warnings.push('Falta uma saída fácil no primeiro toque (ex.: "Se não fizer sentido, é só responder NÃO").');
  return warnings;
}
