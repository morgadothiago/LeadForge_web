import { prisma } from "@/lib/prisma";
import { bearerToken } from "@/lib/auth/session-token";
import { verifyAccessToken } from "./token";

const BASE = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };

export function ok(data: unknown, meta?: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(meta ? { data, meta } : { data }), { status, headers: BASE });
}
export function fail(status: number, code: string, message: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers: { ...BASE, ...extra } });
}
export const invalidInput = (message = "Dados inválidos.") => fail(400, "invalid_input", message);
export const invalidCredentials = () => fail(401, "invalid_credentials", "Credenciais inválidas.");
export const tooMany = (seconds: number) =>
  fail(429, "rate_limited", "Muitas tentativas. Aguarde e tente novamente.", { "Retry-After": String(Math.max(1, Math.ceil(seconds))) });

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

export interface MobileAuth { userId: string; deviceId: string }

/** Guard Bearer mobile: assinatura + aud + exp + dispositivo não revogado. Sempre 401 JSON (nunca redirect). */
export async function requireMobile(req: Request): Promise<MobileAuth | Response> {
  const r = await verifyAccessToken(bearerToken(req.headers.get("authorization")));
  if (!r.ok) {
    return r.code === "token_expired" ? fail(401, "token_expired", "Sessão expirada.") : fail(401, "unauthorized", "Não autenticado.");
  }
  const d = await prisma.mobileDevice.findUnique({ where: { id: r.deviceId }, select: { userId: true, revokedAt: true, refreshExpiresAt: true } });
  if (!d || d.revokedAt || d.userId !== r.userId) return fail(401, "unauthorized", "Não autenticado.");
  return { userId: r.userId, deviceId: r.deviceId };
}

/** Paginação por cursor (id uuid opaco em base64url). limit padrão 20, máx. 50. */
export function parsePage(url: URL): { limit: number; cursor?: string } | Response {
  const raw = url.searchParams.get("limit");
  let limit = 20;
  if (raw !== null) {
    if (!/^\d+$/.test(raw) || Number(raw) < 1) return invalidInput("limit inválido.");
    limit = Math.min(Number(raw), 50);
  }
  const c = url.searchParams.get("cursor");
  if (c === null) return { limit };
  const id = Buffer.from(c, "base64url").toString("utf8");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) || Buffer.from(id).toString("base64url") !== c) return invalidInput("cursor inválido.");
  return { limit, cursor: id };
}
export const encodeCursor = (id: string) => Buffer.from(id).toString("base64url");
