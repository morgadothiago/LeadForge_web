import { createHash, randomBytes } from "node:crypto";

/**
 * SPEC-054a — exclusao de conta (LGPD art. 18). Constantes e tokens.
 *
 * D-054-2 (INFERRED): janela de arrependimento = 30 dias apos CONFIRMAR o e-mail; a anonimizacao so ocorre na purga.
 * Token de confirmacao: uso unico, 24h (mesma ordem de grandeza do reset de senha, SPEC-038) e so o sha256 vai ao banco.
 */
export const DELETION_WINDOW_DAYS = 30;
export const DELETION_WINDOW_MS = DELETION_WINDOW_DAYS * 24 * 3600_000;
export const DELETION_CONFIRM_TTL_MS = 24 * 3600_000;

export function newDeletionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashDeletionToken(token) };
}

export function hashDeletionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Hash do e-mail (minusculo) guardado em `AccountDeletionRequest.emailHash` — nunca o e-mail em claro. */
export function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

/** E-mail placeholder (unico por usuario, dominio reservado `.invalid`) gravado ao anonimizar o `User`. */
export function anonymizedEmail(userId: string): string {
  return `removido-${userId}@removido.invalid`;
}
export const ANONYMIZED_NAME = "Usuário removido";
