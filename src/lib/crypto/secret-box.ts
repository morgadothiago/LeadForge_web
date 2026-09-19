import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getEncryptionKey } from "@/lib/env";

/**
 * AES-256-GCM. Payload: `v1:<iv b64>:<tag b64>:<cipher b64>`. IV aleatório de 12 bytes por segredo; tag de 16 bytes.
 * A versão no prefixo permite rotação futura de chave/algoritmo. Nunca logue o retorno de decrypt.
 */
const VERSION = "v1";

export function encrypt(plain: string, key: Buffer = getEncryptionKey()): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [VERSION, iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decrypt(payload: string, key: Buffer = getEncryptionKey()): string {
  const [v, iv, tag, data] = payload.split(":");
  if (v !== VERSION || !iv || !tag || !data) throw new Error("Segredo cifrado em formato inválido.");
  try {
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch {
    throw new Error("Não foi possível decifrar o segredo (chave incorreta ou dado adulterado).");
  }
}
