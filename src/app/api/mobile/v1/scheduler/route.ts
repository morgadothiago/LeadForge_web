import { ok, requireMobile } from "@/lib/mobile/http";
import { getMobileScheduler } from "@/lib/mobile/metrics";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const a = await requireMobile(req);
  if (a instanceof Response) return a;
  return ok(await getMobileScheduler(new Date()));
}
