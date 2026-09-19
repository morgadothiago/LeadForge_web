/** Configuração da ingestão de leads (SPEC-014). DESLIGADA por padrão: exige a flag exata "true" E INGEST_SECRET com 32+ chars. */
export const MIN_INGEST_SECRET_LENGTH = 32;
export const MAX_BODY_BYTES = 1024 * 1024;
export const MAX_LEADS_PER_CALL = 100;

type Env = Record<string, string | undefined>;

export function isIngestEnabled(env: Env = process.env): boolean {
  return env.INTEGRATION_LEADS_ENABLED === "true";
}
export function getIngestSecret(env: Env = process.env): string | null {
  const s = env.INGEST_SECRET;
  return s && s.length >= MIN_INGEST_SECRET_LENGTH ? s : null;
}
