import { prisma } from "@/lib/prisma";
import { fail, ok, requireMobile } from "@/lib/mobile/http";
import { sweepThrottled } from "@/lib/mobile/alerts";
import { resolveOrgId } from "@/lib/mobile/org";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const a = await requireMobile(req);
  if (a instanceof Response) return a;
  const orgId = await resolveOrgId(a.userId);
  if (!orgId) return fail(403, "forbidden", "Sem permissão.");
  await sweepThrottled().catch(() => {});
  return ok({ count: await prisma.mobileAlert.count({ where: { orgId, readAt: null } }) });
}
