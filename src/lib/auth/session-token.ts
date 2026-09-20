import { SignJWT, jwtVerify } from "jose";
import { SESSION_TTL_SECONDS } from "./config";

export interface SessionPayload {
  userId: string;
}

function key(secret?: string): Uint8Array {
  const s = secret ?? process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET ausente ou menor que 32 caracteres.");
  return new TextEncoder().encode(s);
}

/** JWT HS256 assinado com AUTH_SECRET. Seguro para o proxy (sem next/headers, sem banco). */
export async function signSessionToken(userId: string, opts: { ttlSeconds?: number; secret?: string; now?: Date } = {}): Promise<string> {
  const iat = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + (opts.ttlSeconds ?? SESSION_TTL_SECONDS))
    .sign(key(opts.secret));
}

/** Retorna null se ausente, adulterado, expirado ou algoritmo diferente de HS256. */
export async function verifySessionToken(token: string | undefined, secret?: string): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    return payload.sub ? { userId: payload.sub } : null;
  } catch {
    return null;
  }
}

/** Extrai o token de "Authorization: Bearer <token>" (clientes mobile). null se ausente/malformado. */
export function bearerToken(header: string | null | undefined): string | undefined {
  const m = header?.match(/^Bearer\s+(\S+)$/i);
  return m?.[1];
}
