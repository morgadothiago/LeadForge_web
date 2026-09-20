import { fail, readJson } from "@/lib/mobile/http";
import { mobileAction, paramId, rejectDraftMobile } from "@/lib/mobile/actions";
import { rejectDraftBodySchema } from "@/lib/mobile/schemas";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = await paramId(ctx);
  if (!id) return fail(404, "not_found", "Rascunho não encontrado.");
  const p = rejectDraftBodySchema.safeParse(await readJson(req));
  return mobileAction(req, {
    action: "draft.reject", target: id,
    run: async (a) => (p.success ? rejectDraftMobile(a, id, p.data.reason) : { ok: false, status: 400, code: "invalid_input", message: "Informe o motivo." }),
  });
}
