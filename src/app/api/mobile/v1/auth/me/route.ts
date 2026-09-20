import { prisma } from "@/lib/prisma";
import { fail, ok, requireMobile } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const a = await requireMobile(req);
  if (a instanceof Response) return a;
  const u = await prisma.user.findUnique({ where: { id: a.userId }, select: { id: true, name: true, role: true } });
  if (!u) return fail(401, "unauthorized", "Não autenticado.");
  return ok({ ...u, deviceId: a.deviceId });
}
