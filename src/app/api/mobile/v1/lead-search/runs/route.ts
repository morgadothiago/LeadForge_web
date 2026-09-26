import { encodeCursor, fail, ok, parsePage, requireMobile } from "@/lib/mobile/http";
import { listMobileSearchRuns } from "@/lib/mobile/metrics";
import { resolveOrgId } from "@/lib/mobile/org";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const a = await requireMobile(req);
  if (a instanceof Response) return a;
  const orgId = await resolveOrgId(a.userId);
  if (!orgId) return fail(403, "forbidden", "Sem permissão.");
  const page = parsePage(new URL(req.url));
  if (page instanceof Response) return page;
  const { items, hasMore } = await listMobileSearchRuns(orgId, page);
  return ok(items, { nextCursor: hasMore ? encodeCursor(items[items.length - 1].id) : null });
}
