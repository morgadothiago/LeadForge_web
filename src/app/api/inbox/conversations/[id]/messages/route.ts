import { invalidInput, ok } from "@/lib/mobile/http";
import { conversationNotFound, inboxReadGuard, parseLimit } from "@/lib/inbox/http";
import { listMessages } from "@/lib/inbox/messages";
import { UUID_RE } from "@/lib/inbox/cursor";

export const dynamic = "force-dynamic";

/**
 * SPEC-068a: mensagens de uma conversa DA ORG da sessão (404 uniforme para inexistente ou de outra org). Sem parâmetro = as mais recentes;
 * `before=<cursor>` = histórico mais antigo; `since=<cursor>` = só as novas (polling) + `statuses` das enviadas recentes. `limit<=50`.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const g = await inboxReadGuard();
  if (g instanceof Response) return g;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return conversationNotFound();
  const q = new URL(req.url).searchParams;
  const limit = parseLimit(q.get("limit"));
  if (limit === null) return invalidInput("limit inválido.");
  const before = q.get("before");
  const since = q.get("since");
  if (before !== null && since !== null) return invalidInput("Use before ou since, não os dois.");
  const r = await listMessages(g.orgId, id, { before: before ?? undefined, since: since ?? undefined, limit });
  if (r === null) return conversationNotFound();
  if (r === "invalid_cursor") return invalidInput("cursor inválido.");
  const { items, ...meta } = r;
  return ok(items, meta);
}
