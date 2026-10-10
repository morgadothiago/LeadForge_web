import { ForbiddenError, OrgSuspendedError, requireActiveProviderOrg, requireProviderOrg } from "@/lib/auth/require-admin";
import { UnauthorizedError } from "@/lib/auth/require-user";
import { isAppError, safeErrorForLog } from "@/lib/errors";
import { fail } from "@/lib/mobile/http";
import { forbiddenOrigin, sameOriginOk } from "@/lib/notifications/http";

/** SPEC-050: guard + mapeamento de erro dos route handlers `/api/storage/*` (401/403/4xx JSON, nunca redirect nem stack). */
export async function withStorageAuth(
  req: Request,
  mode: "read" | "write",
  fn: (ctx: { orgId: string; userId: string }) => Promise<Response>,
): Promise<Response> {
  try {
    if (mode === "write" && !sameOriginOk(req)) return forbiddenOrigin();
    const { user, orgId } = mode === "write" ? await requireActiveProviderOrg() : await requireProviderOrg();
    return await fn({ orgId, userId: user.id });
  } catch (e) {
    return storageErrorResponse(e);
  }
}

export function storageErrorResponse(e: unknown): Response {
  if (e instanceof UnauthorizedError) return fail(401, "unauthorized", "Não autenticado.");
  if (e instanceof ForbiddenError) return fail(403, "forbidden", "Sem permissão.");
  if (e instanceof OrgSuspendedError) return fail(403, "org_suspended", "Assinatura pendente ou cancelada.");
  if (isAppError(e)) {
    const status = e.status ?? (e.code === "config" ? 503 : e.code === "not_found" ? 404 : e.code === "validation" ? 400 : 500);
    if (status >= 500) console.error("[storage]", safeErrorForLog(e));
    return fail(status, e.code, e.userMessage);
  }
  console.error("[storage] erro inesperado:", safeErrorForLog(e));
  return fail(500, "internal", "Não foi possível concluir a operação.");
}
