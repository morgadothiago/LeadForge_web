import { prisma } from "@/lib/prisma";
import { fail, ok, requireMobile } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

/** Idempotente: marcar de novo nao altera readAt. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const a = await requireMobile(req);
  if (a instanceof Response) return a;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, "not_found", "Alerta não encontrado.");
  await prisma.mobileAlert.updateMany({ where: { id, readAt: null }, data: { readAt: new Date() } });
  const cur = await prisma.mobileAlert.findUnique({ where: { id }, select: { id: true, readAt: true } });
  return cur ? ok({ id: cur.id, readAt: cur.readAt }) : fail(404, "not_found", "Alerta não encontrado.");
}
