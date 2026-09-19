/** Comportamento humano (SPEC-017): 45-180 s entre envios da instância; rajada de até 5 seguidas de pausa de 10-20 min. */
export const MIN_INTERVAL_MS = 45_000;
export const MAX_INTERVAL_MS = 180_000;
export const BURST_SIZE = 5;
export const BURST_PAUSE_MIN_MS = 10 * 60_000;
export const BURST_PAUSE_MAX_MS = 20 * 60_000;

/** PRNG determinístico (mulberry32). */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Próximo instante permitido para enviar pela MESMA instância. Puro; `recentSentAts` = sentAt recentes (qualquer ordem; aceita um único Date).
 * Rajada = sequência de envios com intervalos < 10 min; ao completar 5, exige pausa aleatória 10-20 min; senão intervalo 45-180 s.
 * `rng` default é SEMENTE do último envio (a mesma pergunta devolve sempre a mesma resposta: o sorteio não é refeito a cada tentativa).
 */
export function nextAllowedSendAt(
  recentSentAts: ReadonlyArray<Date> | Date | null | undefined,
  now: Date,
  rng?: () => number,
): Date {
  const list = recentSentAts == null ? [] : Array.isArray(recentSentAts) ? [...recentSentAts] : [recentSentAts as Date];
  list.sort((a, b) => b.getTime() - a.getTime());
  const last = list[0];
  if (!last) return now;
  const rand = rng ?? seededRng(last.getTime());
  let burst = 1;
  for (let i = 1; i < list.length; i++) {
    if (list[i - 1].getTime() - list[i].getTime() >= BURST_PAUSE_MIN_MS) break;
    burst++;
  }
  const gap = burst >= BURST_SIZE
    ? BURST_PAUSE_MIN_MS + Math.floor(rand() * (BURST_PAUSE_MAX_MS - BURST_PAUSE_MIN_MS + 1))
    : MIN_INTERVAL_MS + Math.floor(rand() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS + 1));
  const at = last.getTime() + gap;
  return at > now.getTime() ? new Date(at) : now;
}
