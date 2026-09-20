import { invalidInput, ok, requireMobile } from "@/lib/mobile/http";
import { getMobileSummary } from "@/lib/mobile/metrics";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const a = await requireMobile(req);
  if (a instanceof Response) return a;
  const p = new URL(req.url).searchParams.get("period") ?? "7d";
  if (p !== "7d" && p !== "30d") return invalidInput("period inválido.");
  return ok(await getMobileSummary(p, new Date()));
}
