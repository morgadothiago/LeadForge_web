import { fail, ok, requireMobile } from "@/lib/mobile/http";
import { DRAFT_SELECT, draftDetail, paramId } from "@/lib/mobile/actions";
import { resolveOrgId } from "@/lib/mobile/org";
import { scopedPrisma } from "@/lib/tenant/scoped-prisma";

export const dynamic = "force-dynamic";

/** SPEC-026: corpo completo sob demanda (no-store; nunca em cache persistente no app). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const a = await requireMobile(req);
  if (a instanceof Response) return a;
  const orgId = await resolveOrgId(a.userId);
  if (!orgId) return fail(403, "forbidden", "Sem permissão.");
  const id = await paramId(ctx);
  const d = id ? await scopedPrisma(orgId).draft.findUnique({ where: { id }, select: DRAFT_SELECT }) : null;
  return d ? ok(draftDetail(d)) : fail(404, "not_found", "Rascunho não encontrado.");
}
