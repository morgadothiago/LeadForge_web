import { prisma } from "@/lib/prisma";
import { encodeCursor, invalidInput, ok, parsePage, requireMobile } from "@/lib/mobile/http";
import { alertView, sweepThrottled } from "@/lib/mobile/alerts";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const a = await requireMobile(req);
  if (a instanceof Response) return a;
  const url = new URL(req.url);
  const page = parsePage(url);
  if (page instanceof Response) return page;
  const u = url.searchParams.get("unread");
  if (u !== null && u !== "true" && u !== "false") return invalidInput("unread inválido.");
  await sweepThrottled().catch(() => {});
  const rows = await prisma.mobileAlert.findMany({
    where: u === "true" ? { readAt: null } : u === "false" ? { readAt: { not: null } } : {},
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: page.limit + 1,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
  });
  const items = rows.slice(0, page.limit);
  return ok(items.map(alertView), { nextCursor: rows.length > page.limit ? encodeCursor(items[items.length - 1].id) : null });
}
