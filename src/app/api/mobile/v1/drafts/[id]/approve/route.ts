import { fail } from "@/lib/mobile/http";
import { approveDraftMobile, mobileAction, paramId } from "@/lib/mobile/actions";

export const dynamic = "force-dynamic";

/** SPEC-026: sem edicao no mobile. Reserva atomica pending->approved: segundo toque = 409 (ou replay com Idempotency-Key), nunca segundo envio. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = await paramId(ctx);
  if (!id) return fail(404, "not_found", "Rascunho não encontrado.");
  return mobileAction(req, { action: "draft.approve", target: id, run: (a) => approveDraftMobile(a, id) });
}
