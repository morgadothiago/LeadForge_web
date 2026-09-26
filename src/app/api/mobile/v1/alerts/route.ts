import { prisma } from "@/lib/prisma";
import { encodeCursor, fail, invalidInput, ok, parsePage, requireMobile } from "@/lib/mobile/http";
import { alertView, sweepThrottled } from "@/lib/mobile/alerts";
import { resolveOrgId } from "@/lib/mobile/org";

export const dynamic = "force-dynamic";

/** SPEC-030: `orgId` resolvido pela Membership do usuário — nunca lista alertas de outra Organization. */
export async function GET(req: Request): Promise<Response> {
  const a = await requireMobile(req);
  if (a instanceof Response) return a;
  const orgId = await resolveOrgId(a.userId);
  if (!orgId) return fail(403, "forbidden", "Sem permissão.");
  const url = new URL(req.url);
  const page = parsePage(url);
  if (page instanceof Response) return page;
  const u = url.searchParams.get("unread");
  if (u !== null && u !== "true" && u !== "false") return invalidInput("unread inválido.");
  await sweepThrottled().catch(() => {});
  const rows = await prisma.mobileAlert.findMany({
    where: { orgId, kind: { not: "baseline" }, ...(u === "true" ? { readAt: null } : u === "false" ? { readAt: { not: null } } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: page.limit + 1,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
  });
  const items = rows.slice(0, page.limit);
  return ok(items.map(alertView), { nextCursor: rows.length > page.limit ? encodeCursor(items[items.length - 1].id) : null });
}
