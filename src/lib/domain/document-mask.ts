import { onlyDigits } from "./document";

/**
 * SPEC-065b (D-065-27.2) — mascara progressiva de CPF/CNPJ para o campo do `/signup` (so apresentacao; a validacao e `parseDocument`).
 * Ate 11 digitos = CPF (000.000.000-00); de 12 a 14 = CNPJ (00.000.000/0000-00); o excedente e descartado.
 */
export function maskDocument(value: string): string {
  const d = onlyDigits(value).slice(0, 14);
  if (d.length <= 11) {
    return d.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1-$2");
  }
  return d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
}
