import { encodeCursor, invalidInput, ok, parsePage, requireMobile } from "@/lib/mobile/http";
import { listMobileCampaigns } from "@/lib/mobile/metrics";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const a = await requireMobile(req);
  if (a instanceof Response) return a;
  const url = new URL(req.url);
  const page = parsePage(url);
  if (page instanceof Response) return page;
  const status = url.searchParams.get("status") ?? "active";
  if (status !== "active" && status !== "paused" && status !== "archived") return invalidInput("status inválido.");
  const { items, hasMore } = await listMobileCampaigns(status, page);
  return ok(items, { nextCursor: hasMore ? encodeCursor(items[items.length - 1].id) : null });
}
