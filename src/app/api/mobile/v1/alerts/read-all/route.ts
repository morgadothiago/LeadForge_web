import { prisma } from "@/lib/prisma";
import { fail, ok, requireMobile } from "@/lib/mobile/http";
import { resolveOrgId } from "@/lib/mobile/org";

export const dynamic = "force-dynamic";

/** Idempotente: marca todos como lidos (sem sobrescrever readAt existente). SPEC-030: so os DESTA org. */
export async function POST(req: Request): Promise<Response> {
  const a = await requireMobile(req);
  if (a instanceof Response) return a;
  const orgId = await resolveOrgId(a.userId);
  if (!orgId) return fail(403, "forbidden", "Sem permissão.");
  const r = await prisma.mobileAlert.updateMany({ where: { orgId, readAt: null }, data: { readAt: new Date() } });
  return ok({ updated: r.count });
}
