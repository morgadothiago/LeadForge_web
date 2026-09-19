import { hash, verify } from "@node-rs/argon2";

/** argon2id (defaults do @node-rs/argon2: m=19456, t=2, p=1 — recomendação OWASP). */
export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

/** Retorna false (nunca lança) para hash malformado/ausente. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;
/** Hash descartável (mesmos parâmetros) para igualar o tempo de login quando o usuário não existe. */
export function getDummyHash(): Promise<string> {
  return (dummy ??= hashPassword("leadforge-dummy-password"));
}
