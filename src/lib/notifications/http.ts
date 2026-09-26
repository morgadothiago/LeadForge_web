import { createHash } from "node:crypto";
import { UnauthorizedError, requireUser, type CurrentUser } from "@/lib/auth/require-user";
import { fail } from "@/lib/mobile/http";

/** SPEC-028: guard de SESSAO (cookie) para /api/notifications/*. 401 JSON (nunca redirect). Bearer mobile NAO vale aqui. */
export async function requireSession(): Promise<CurrentUser | Response> {
  try {
    return await requireUser();
  } catch (e) {
    if (e instanceof UnauthorizedError) return fail(401, "unauthorized", "Não autenticado.");
    throw e;
  }
}

/** POST com cookie de sessao: recusa Origin de outro host (defesa CSRF alem de sameSite=lax). Sem Origin (curl/servidor) passa. */
export function sameOriginOk(req: Request): boolean {
  const o = req.headers.get("origin");
  if (!o) return true;
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
    return new URL(o).host === host;
  } catch {
    return false;
  }
}
export const forbiddenOrigin = () => fail(403, "forbidden", "Origem não permitida.");

export const etagOf = (body: string) => `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`;

export function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header.split(",").map((t) => t.trim().replace(/^W\//, "")).some((t) => t === etag || t === "*");
}

/** Cursor opaco `createdAtMs|id` em base64url. */
export const encodeCursor = (createdAt: Date, id: string) => Buffer.from(`${createdAt.getTime()}|${id}`).toString("base64url");
export function decodeCursor(c: string): { createdAt: Date; id: string } | null {
  const raw = Buffer.from(c, "base64url").toString("utf8");
  const m = /^(\d{1,15})\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(raw);
  if (!m || Buffer.from(raw).toString("base64url") !== c) return null;
  return { createdAt: new Date(Number(m[1])), id: m[2] };
}
