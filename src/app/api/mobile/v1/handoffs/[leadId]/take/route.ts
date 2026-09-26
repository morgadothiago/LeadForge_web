import { fail } from "@/lib/mobile/http";
import { mobileAction, paramId, takeHandoff } from "@/lib/mobile/actions";

export const dynamic = "force-dynamic";

/** SPEC-026: o agente para naquele lead (SPEC-019). Idempotente. Sem telefone/e-mail na resposta. */
export async function POST(req: Request, ctx: { params: Promise<{ leadId: string }> }): Promise<Response> {
  const id = await paramId(ctx);
  if (!id) return fail(404, "not_found", "Lead não encontrado.");
  return mobileAction(req, { action: "handoff.take", target: id, run: (a) => takeHandoff(a, id) });
}
