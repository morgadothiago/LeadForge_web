import { encodeCursor, fail, invalidInput, ok, parsePage, requireMobile } from "@/lib/mobile/http";
import { listMobileCampaigns } from "@/lib/mobile/metrics";
import { resolveOrgId } from "@/lib/mobile/org";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const a = await requireMobile(req);
  if (a instanceof Response) return a;
  const orgId = await resolveOrgId(a.userId);
  if (!orgId) return fail(403, "forbidden", "Sem permissão.");
  const url = new URL(req.url);
  const page = parsePage(url);
  if (page instanceof Response) return page;
  const status = url.searchParams.get("status") ?? "active";
  if (status !== "active" && status !== "paused" && status !== "archived") return invalidInput("status inválido.");
  const { items, hasMore } = await listMobileCampaigns(orgId, status, page);
  return ok(items, { nextCursor: hasMore ? encodeCursor(items[items.length - 1].id) : null });
}
