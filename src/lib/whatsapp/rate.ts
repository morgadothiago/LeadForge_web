export const MIN_INTERVAL_MS = 20_000;
export const MAX_INTERVAL_MS = 60_000;

/**
 * Intervalo aleatório mínimo (20-60s) entre envios da MESMA instância. Puro: o canal usa o resultado para adiar
 * (sem sleep dentro do request). `rng` devolve [0,1).
 */
export function nextAllowedSendAt(lastSentAt: Date | null | undefined, now: Date, rng: () => number = Math.random): Date {
  if (!lastSentAt) return now;
  const gap = MIN_INTERVAL_MS + Math.floor(rng() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS + 1));
  const at = lastSentAt.getTime() + gap;
  return at > now.getTime() ? new Date(at) : now;
}
