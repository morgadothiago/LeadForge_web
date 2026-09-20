import { prisma } from "@/lib/prisma";
import { ok, requireMobile } from "@/lib/mobile/http";
import { sweepThrottled } from "@/lib/mobile/alerts";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const a = await requireMobile(req);
  if (a instanceof Response) return a;
  await sweepThrottled().catch(() => {});
  return ok({ count: await prisma.mobileAlert.count({ where: { readAt: null } }) });
}
