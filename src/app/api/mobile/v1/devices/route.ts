import { prisma } from "@/lib/prisma";
import { encodeCursor, ok, parsePage, requireMobile } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const a = await requireMobile(req);
  if (a instanceof Response) return a;
  const page = parsePage(new URL(req.url));
  if (page instanceof Response) return page;
  const rows = await prisma.mobileDevice.findMany({
    where: { userId: a.userId, revokedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: page.limit + 1,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    select: { id: true, name: true, platform: true, appVersion: true, createdAt: true, lastSeenAt: true },
  });
  const items = rows.slice(0, page.limit).map((d) => ({ ...d, current: d.id === a.deviceId }));
  return ok(items, { nextCursor: rows.length > page.limit ? encodeCursor(items[items.length - 1].id) : null });
}
