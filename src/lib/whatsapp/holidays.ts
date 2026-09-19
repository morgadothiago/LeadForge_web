/**
 * Feriados nacionais brasileiros (SPEC-017). Fonte: Lei 662/1949 e Lei 10.607/2002 (fixos federais; Consciência Negra, 20/11, é
 * feriado nacional desde a Lei 14.759/2023) + Sexta-feira Santa (Lei 9.093/1995, móvel). Carnaval (segunda e terça) e Corpus Christi
 * são pontos facultativos nacionais; tratados como feriado por cautela (dia de baixa atenção = mais denúncia). Sem feriados
 * estaduais/municipais. Móveis calculados a partir da Páscoa (algoritmo anônimo gregoriano, Meeus/Jones/Butcher): vale para qualquer ano.
 */
const FIXED: ReadonlyArray<readonly [number, number]> = [
  [1, 1], [4, 21], [5, 1], [9, 7], [10, 12], [11, 2], [11, 15], [11, 20], [12, 25],
];

/** Domingo de Páscoa (mês 1-12, dia). */
export function easterSunday(year: number): { mo: number; d: number } {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return { mo, d: day };
}

const cache = new Map<number, ReadonlySet<string>>();
const key = (mo: number, d: number): string => `${mo}-${d}`;

/** Conjunto "mo-d" dos feriados do ano (fixos + Carnaval seg/ter, Sexta Santa, Corpus Christi). */
export function holidaysOfYear(year: number): ReadonlySet<string> {
  let s = cache.get(year);
  if (!s) {
    const set = new Set<string>(FIXED.map(([mo, d]) => key(mo, d)));
    const e = easterSunday(year);
    for (const off of [-48, -47, -2, 60]) {
      const t = new Date(Date.UTC(year, e.mo - 1, e.d + off));
      set.add(key(t.getUTCMonth() + 1, t.getUTCDate()));
    }
    cache.set(year, (s = set));
  }
  return s;
}

export function isBrazilianHoliday(year: number, month: number, day: number): boolean {
  return holidaysOfYear(year).has(key(month, day));
}
