import { prisma } from "@/lib/prisma";
import { fail, ok, requireMobile } from "@/lib/mobile/http";
import { resolveOrgId } from "@/lib/mobile/org";

export const dynamic = "force-dynamic";

/** Idempotente: marcar de novo nao altera readAt. SPEC-030: IDOR corrigido — so acha/altera alerta DESTA org (nunca revela que existe em outra). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const a = await requireMobile(req);
  if (a instanceof Response) return a;
  const orgId = await resolveOrgId(a.userId);
  if (!orgId) return fail(403, "forbidden", "Sem permissão.");
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, "not_found", "Alerta não encontrado.");
  await prisma.mobileAlert.updateMany({ where: { id, orgId, readAt: null }, data: { readAt: new Date() } });
  const cur = await prisma.mobileAlert.findFirst({ where: { id, orgId }, select: { id: true, readAt: true } });
  return cur ? ok({ id: cur.id, readAt: cur.readAt }) : fail(404, "not_found", "Alerta não encontrado.");
}
