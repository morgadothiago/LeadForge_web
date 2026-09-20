import { prisma } from "@/lib/prisma";
import { fail, ok, requireMobile } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

/** Revoga remotamente um dispositivo do próprio usuário. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const a = await requireMobile(req);
  if (a instanceof Response) return a;
  const { id } = await ctx.params;
  const r = await prisma.mobileDevice.updateMany({ where: { id, userId: a.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  return r.count === 1 ? ok({ revoked: true }) : fail(404, "not_found", "Dispositivo não encontrado.");
}
