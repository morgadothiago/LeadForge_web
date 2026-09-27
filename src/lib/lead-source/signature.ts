import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verificação `X-Hub-Signature-256` da Graph API (Meta): `sha256=<hex hmac do corpo CRU com o App Secret>`.
 * Compara em tempo constante. Deve ser chamada ANTES de qualquer parse/efeito colateral do corpo (o corpo já
 * lido/decodificado é só texto puro aqui — nada é persistido nem despachado antes desta checagem passar).
 */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const presented = Buffer.from(m[1], "hex");
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}
