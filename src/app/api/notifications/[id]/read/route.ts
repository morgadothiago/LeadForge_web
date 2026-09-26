import { prisma } from "@/lib/prisma";
import { fail, ok } from "@/lib/mobile/http";
import { forbiddenOrigin, requireSession, sameOriginOk } from "@/lib/notifications/http";

export const dynamic = "force-dynamic";

/** SPEC-028: marca uma notificacao como lida (sessao). Idempotente: nao sobrescreve readAt. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const a = await requireSession();
  if (a instanceof Response) return a;
  if (!a.orgId) return fail(403, "forbidden", "Sem permissão.");
  if (!sameOriginOk(req)) return forbiddenOrigin();
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, "not_found", "Notificação não encontrada.");
  await prisma.mobileAlert.updateMany({ where: { id, orgId: a.orgId, readAt: null, kind: { not: "baseline" } }, data: { readAt: new Date() } });
  const cur = await prisma.mobileAlert.findFirst({ where: { id, orgId: a.orgId, kind: { not: "baseline" } }, select: { id: true, readAt: true } });
  return cur ? ok({ id: cur.id, readAt: cur.readAt }) : fail(404, "not_found", "Notificação não encontrada.");
}
