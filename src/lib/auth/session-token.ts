import { SignJWT, jwtVerify } from "jose";
import { SESSION_TTL_SECONDS } from "./config";

/** SPEC-030: papel de PLATAFORMA (não confundir com `Membership.orgRole`, papel dentro do tenant). */
export type PlatformRole = "provider" | "platform_admin";

export interface SessionPayload {
  userId: string;
  /** null só para `platform_admin` (sem Organization própria — D-30-1). */
  orgId: string | null;
  platformRole: PlatformRole;
  /**
   * SPEC-038 (D-038-2): momento (epoch MILLISSEGUNDOS, claim customizada `imts`) em que o token foi
   * emitido — `requireUser()` compara com `User.sessionsInvalidatedAt` para rejeitar sessões emitidas
   * ANTES de uma redefinição de senha. Claim própria (não o `iat` padrão do JWT, que só tem resolução de
   * SEGUNDOS) para não perder a invalidação por corrida quando emissão/invalidação caem no mesmo segundo.
   */
  issuedAtMs: number;
}

function key(secret?: string): Uint8Array {
  const s = secret ?? process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET ausente ou menor que 32 caracteres.");
  return new TextEncoder().encode(s);
}

/** JWT HS256 assinado com AUTH_SECRET. Seguro para o proxy (sem next/headers, sem banco). */
export async function signSessionToken(
  userId: string,
  orgId: string | null,
  platformRole: PlatformRole,
  opts: { ttlSeconds?: number; secret?: string; now?: Date } = {},
): Promise<string> {
  const now = opts.now ?? new Date();
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ orgId, platformRole, imts: now.getTime() })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + (opts.ttlSeconds ?? SESSION_TTL_SECONDS))
    .sign(key(opts.secret));
}

/** Retorna null se ausente, adulterado, expirado, algoritmo diferente de HS256 ou payload incompleto. */
export async function verifySessionToken(token: string | undefined, secret?: string): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    if (payload.platformRole !== "provider" && payload.platformRole !== "platform_admin") return null;
    if (typeof payload.imts !== "number") return null;
    const orgId = typeof payload.orgId === "string" ? payload.orgId : null;
    return { userId: payload.sub, orgId, platformRole: payload.platformRole, issuedAtMs: payload.imts };
  } catch {
    return null;
  }
}

/** Extrai o token de "Authorization: Bearer <token>" (clientes mobile). null se ausente/malformado. */
export function bearerToken(header: string | null | undefined): string | undefined {
  const m = header?.match(/^Bearer\s+(\S+)$/i);
  return m?.[1];
}
