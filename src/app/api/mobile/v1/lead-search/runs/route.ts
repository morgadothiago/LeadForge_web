import { encodeCursor, ok, parsePage, requireMobile } from "@/lib/mobile/http";
import { listMobileSearchRuns } from "@/lib/mobile/metrics";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const a = await requireMobile(req);
  if (a instanceof Response) return a;
  const page = parsePage(new URL(req.url));
  if (page instanceof Response) return page;
  const { items, hasMore } = await listMobileSearchRuns(page);
  return ok(items, { nextCursor: hasMore ? encodeCursor(items[items.length - 1].id) : null });
}
