import { fail, ok, requireMobile } from "@/lib/mobile/http";
import { getMobileCampaign } from "@/lib/mobile/metrics";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const a = await requireMobile(req);
  if (a instanceof Response) return a;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return fail(404, "not_found", "Não encontrado.");
  const c = await getMobileCampaign(id, new Date());
  return c ? ok(c) : fail(404, "not_found", "Não encontrado.");
}
