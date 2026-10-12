import { ok } from "@/lib/mobile/http";
import { conversationNotFound, inboxReadGuard } from "@/lib/inbox/http";
import { getConversation } from "@/lib/inbox/conversations";
import { UUID_RE } from "@/lib/inbox/cursor";

export const dynamic = "force-dynamic";

/** SPEC-068a: detalhe de uma conversa DA ORG (inclui o bloqueio por supressão global, que a lista não confere). 404 uniforme. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const g = await inboxReadGuard();
  if (g instanceof Response) return g;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return conversationNotFound();
  const c = await getConversation(g.orgId, id, new Date());
  return c ? ok(c) : conversationNotFound();
}
