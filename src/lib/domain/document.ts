/**
 * SPEC-065 (D-065-27) — validacao de CPF/CNPJ (so digitos verificadores; sem consulta a Receita). Aceita com ou sem mascara.
 * Rejeita comprimento errado e sequencias repetidas (111.111.111-11). Funcoes puras (sem I/O), usaveis no cliente e no servidor.
 */

export type DocumentType = "cpf" | "cnpj";

export interface ParsedDocument {
  type: DocumentType;
  /** So digitos (11 para CPF, 14 para CNPJ). */
  digits: string;
}

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function allSame(d: string): boolean {
  return /^(\d)\1+$/.test(d);
}

function cpfCheckDigit(base: number[]): number {
  const weight = base.length + 1;
  const sum = base.reduce((acc, n, i) => acc + n * (weight - i), 0);
  const mod = (sum * 10) % 11;
  return mod === 10 ? 0 : mod;
}

export function isValidCpf(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11 || allSame(d)) return false;
  const n = d.split("").map(Number);
  return cpfCheckDigit(n.slice(0, 9)) === n[9] && cpfCheckDigit(n.slice(0, 10)) === n[10];
}

function cnpjCheckDigit(base: number[]): number {
  const weights = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = base.reduce((acc, n, i) => acc + n * weights[i], 0);
  const mod = sum % 11;
  return mod < 2 ? 0 : 11 - mod;
}

export function isValidCnpj(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 14 || allSame(d)) return false;
  const n = d.split("").map(Number);
  return cnpjCheckDigit(n.slice(0, 12)) === n[12] && cnpjCheckDigit(n.slice(0, 13)) === n[13];
}

/** `null` = invalido (comprimento, sequencia repetida ou digito verificador). */
export function parseDocument(value: string): ParsedDocument | null {
  const digits = onlyDigits(value);
  if (digits.length === 11 && isValidCpf(digits)) return { type: "cpf", digits };
  if (digits.length === 14 && isValidCnpj(digits)) return { type: "cnpj", digits };
  return null;
}

/** Chave canonica do anti-abuso (D-065-27.3): CPF = 11 digitos; CNPJ = RAIZ de 8 digitos (matriz e filiais = mesma empresa). */
export function canonicalDocumentKey(doc: ParsedDocument): string {
  return doc.type === "cnpj" ? doc.digits.slice(0, 8) : doc.digits;
}
