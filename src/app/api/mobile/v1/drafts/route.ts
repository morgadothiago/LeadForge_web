import { prisma } from "@/lib/prisma";
import { encodeCursor, invalidInput, ok, parsePage, requireMobile } from "@/lib/mobile/http";
import { DRAFT_SELECT, draftListItem } from "@/lib/mobile/actions";

export const dynamic = "force-dynamic";

/** SPEC-026: fila de aprovacao. Corpo TRUNCADO (280) e nome mascarado; corpo completo so em GET /drafts/{id}. Somente status=pending. */
export async function GET(req: Request): Promise<Response> {
  const a = await requireMobile(req);
  if (a instanceof Response) return a;
  const url = new URL(req.url);
  if ((url.searchParams.get("status") ?? "pending") !== "pending") return invalidInput("status inválido.");
  const page = parsePage(url);
  if (page instanceof Response) return page;
  const rows = await prisma.draft.findMany({
    where: { status: "pending" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: page.limit + 1,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    select: DRAFT_SELECT,
  });
  const items = rows.slice(0, page.limit).map(draftListItem);
  return ok(items, { nextCursor: rows.length > page.limit ? encodeCursor(items[items.length - 1].id) : null });
}
