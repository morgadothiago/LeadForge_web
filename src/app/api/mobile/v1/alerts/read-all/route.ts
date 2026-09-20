import { prisma } from "@/lib/prisma";
import { ok, requireMobile } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

/** Idempotente: marca todos como lidos (sem sobrescrever readAt existente). */
export async function POST(req: Request): Promise<Response> {
  const a = await requireMobile(req);
  if (a instanceof Response) return a;
  const r = await prisma.mobileAlert.updateMany({ where: { readAt: null }, data: { readAt: new Date() } });
  return ok({ updated: r.count });
}
