import { randomInt } from "node:crypto";
import { onlyDigits } from "@/lib/domain/document";

/** APENAS testes: gera CPF/CNPJ validos (digitos verificadores corretos) e unicos o bastante entre execucoes. */
function cpfDigit(base: number[]): number {
  const weight = base.length + 1;
  const sum = base.reduce((acc, n, i) => acc + n * (weight - i), 0);
  const mod = (sum * 10) % 11;
  return mod === 10 ? 0 : mod;
}

export function randomCpf(masked = false): string {
  for (;;) {
    const base = Array.from({ length: 9 }, () => randomInt(0, 10));
    if (new Set(base).size === 1) continue;
    const d1 = cpfDigit(base);
    const d2 = cpfDigit([...base, d1]);
    const d = [...base, d1, d2].join("");
    return masked ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : d;
  }
}

function cnpjDigit(base: number[]): number {
  const weights = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const mod = base.reduce((acc, n, i) => acc + n * weights[i], 0) % 11;
  return mod < 2 ? 0 : 11 - mod;
}

/** CNPJ valido. `root` (8 digitos) fixa a raiz (matriz/filial = mesma raiz); `branch` = 4 digitos da ordem (default 0001). */
export function randomCnpj(opts: { root?: string; branch?: string; masked?: boolean } = {}): string {
  const root = opts.root ?? Array.from({ length: 8 }, () => randomInt(0, 10)).join("");
  const base = [...onlyDigits(root + (opts.branch ?? "0001"))].map(Number);
  const d1 = cnpjDigit(base);
  const d2 = cnpjDigit([...base, d1]);
  const d = [...base, d1, d2].join("");
  return opts.masked ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d;
}
