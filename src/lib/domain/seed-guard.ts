/** Dados de teste (seed) nunca são enviáveis (SPEC-013), a menos que ALLOW_SEED_SENDS=true (somente dev). */
export const SEED_SOURCE = "seed";
export const SEED_BLOCK_MESSAGE = "dado de teste (seed)";

export function allowSeedSends(): boolean {
  return process.env.ALLOW_SEED_SENDS?.trim().toLowerCase() === "true";
}
export const isSeedSource = (source: string | null | undefined): boolean => source === SEED_SOURCE;
/** true = o lead não pode receber envio real. */
export const isSeedBlocked = (lead: { source: string | null }): boolean => isSeedSource(lead.source) && !allowSeedSends();
