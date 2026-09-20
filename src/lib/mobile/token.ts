import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify, errors } from "jose";

/** SPEC-021: access token mobile (aud "mobile", 15 min). Segredo DERIVADO e distinto do JWT web (cookie). */
export const MOBILE_AUD = "mobile";
export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function key(): Uint8Array {
  const s = process.env.MOBILE_AUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET ausente ou menor que 32 caracteres.");
  return new Uint8Array(createHmac("sha256", s).update("leadforge:mobile:access:v1").digest());
}

export async function signAccessToken(userId: string, deviceId: string): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  return new SignJWT({ did: deviceId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setAudience(MOBILE_AUD)
    .setJti(randomUUID())
    .setIssuedAt(iat)
    .setExpirationTime(iat + ACCESS_TTL_SECONDS)
    .sign(key());
}

export type AccessResult = { ok: true; userId: string; deviceId: string } | { ok: false; code: "token_expired" | "invalid_token" };

export async function verifyAccessToken(token: string | undefined): Promise<AccessResult> {
  if (!token) return { ok: false, code: "invalid_token" };
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"], audience: MOBILE_AUD });
    if (!payload.sub || typeof payload.did !== "string") return { ok: false, code: "invalid_token" };
    return { ok: true, userId: payload.sub, deviceId: payload.did };
  } catch (e) {
    return { ok: false, code: e instanceof errors.JWTExpired ? "token_expired" : "invalid_token" };
  }
}

/** Refresh opaco: 32 bytes aleatórios (base64url). Só o sha256 é persistido. */
export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashRefresh(token) };
}
export function hashRefresh(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
