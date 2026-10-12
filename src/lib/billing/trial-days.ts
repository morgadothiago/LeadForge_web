/** Dias inteiros restantes (arredonda para cima; minimo 0), para chip/banner/e-mails. Modulo puro: seguro em Client Components. */
export function trialDaysLeft(trialEndsAt: Date | null, now: Date): number {
  if (!trialEndsAt) return 0;
  return Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / (24 * 3600_000)));
}
