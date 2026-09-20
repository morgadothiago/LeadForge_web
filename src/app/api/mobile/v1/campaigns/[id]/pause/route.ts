import { fail } from "@/lib/mobile/http";
import { mobileAction, paramId, setCampaignStatus } from "@/lib/mobile/actions";

export const dynamic = "force-dynamic";

/** SPEC-026: reversivel e idempotente (repetir devolve o mesmo estado). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = await paramId(ctx);
  if (!id) return fail(404, "not_found", "Campanha não encontrada.");
  return mobileAction(req, { action: "campaign.pause", target: id, run: () => setCampaignStatus(id, "paused") });
}
