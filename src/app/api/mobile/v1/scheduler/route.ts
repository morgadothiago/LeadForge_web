import { fail, ok, requireMobile } from "@/lib/mobile/http";
import { getMobileScheduler } from "@/lib/mobile/metrics";
import { resolveOrgId } from "@/lib/mobile/org";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const a = await requireMobile(req);
  if (a instanceof Response) return a;
  const orgId = await resolveOrgId(a.userId);
  if (!orgId) return fail(403, "forbidden", "Sem permissão.");
  return ok(await getMobileScheduler(orgId, new Date()));
}
