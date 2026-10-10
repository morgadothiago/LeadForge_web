import { createHash, randomBytes } from "node:crypto";

/**
 * SPEC-049 (D-049-2): convite nominal. Mesmo padrão de `PasswordResetToken`/`mobile/token`: valor opaco (32 bytes,
 * base64url) só existe no link do e-mail; o banco grava somente o sha256 (`OrgInvite.tokenHash`).
 */
export const INVITE_TTL_DAYS = 7;
export const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 3600_000;

export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Código reutilizável de entrada (`Organization.joinCode`): 20 símbolos de um alfabeto de 32 (sem 0/O/1/I) = 100 bits
 * de entropia. Armazenado normalizado (maiúsculo, sem separadores); exibido em grupos de 4 ("ABCD-EFGH-...").
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const JOIN_CODE_LENGTH = 20;
export const JOIN_CODE_DEFAULT_DAYS = 7;
export const JOIN_CODE_MAX_DAYS = 30;
export const JOIN_CODE_DEFAULT_USES = 10;
export const JOIN_CODE_MAX_USES = 100;

export function newJoinCode(): string {
  const bytes = randomBytes(JOIN_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) out += ALPHABET[bytes[i] % ALPHABET.length]; // 256 % 32 = 0 -> sem viés
  return out;
}

/** Remove espaços/hífens e coloca em maiúsculas. */
export function normalizeJoinCode(input: string): string {
  return input.replace(/[\s-]+/g, "").toUpperCase();
}

export function formatJoinCode(code: string): string {
  return code.match(/.{1,4}/g)?.join("-") ?? code;
}
