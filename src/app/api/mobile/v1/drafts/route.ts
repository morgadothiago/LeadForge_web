import { fail, encodeCursor, invalidInput, ok, parsePage, requireMobile } from "@/lib/mobile/http";
import { DRAFT_SELECT, draftListItem } from "@/lib/mobile/actions";
import { resolveOrgId } from "@/lib/mobile/org";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";

export const dynamic = "force-dynamic";

/** SPEC-026: fila de aprovacao. Corpo TRUNCADO (280) e nome mascarado; corpo completo so em GET /drafts/{id}. Somente status=pending. */
export async function GET(req: Request): Promise<Response> {
  const a = await requireMobile(req);
  if (a instanceof Response) return a;
  const orgId = await resolveOrgId(a.userId);
  if (!orgId) return fail(403, "forbidden", "Sem permissão.");
  const url = new URL(req.url);
  if ((url.searchParams.get("status") ?? "pending") !== "pending") return invalidInput("status inválido.");
  const page = parsePage(url);
  if (page instanceof Response) return page;
  const rows = await scopedPrisma(orgId).draft.findMany({
    where: { status: "pending" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: page.limit + 1,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    select: DRAFT_SELECT,
  });
  type Row = { id: string; channel: string; subject: string | null; body: string; status: string; createdAt: Date; lead: { name: string } };
  const items = (rows as Row[]).slice(0, page.limit).map(draftListItem);
  return ok(items, { nextCursor: rows.length > page.limit ? encodeCursor(items[items.length - 1].id) : null });
}
