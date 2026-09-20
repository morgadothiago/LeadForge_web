import { prisma } from "@/lib/prisma";
import { ok, requireMobile } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

/** SPEC-021: revoga o dispositivo atual (refresh e access deixam de valer na hora). */
export async function POST(req: Request): Promise<Response> {
  const a = await requireMobile(req);
  if (a instanceof Response) return a;
  await prisma.mobileDevice.update({ where: { id: a.deviceId }, data: { revokedAt: new Date() } });
  return ok({ revoked: true });
}
