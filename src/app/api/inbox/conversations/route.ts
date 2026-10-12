import { invalidInput, ok } from "@/lib/mobile/http";
import { inboxReadGuard, parseLimit } from "@/lib/inbox/http";
import { listConversations, type ConversationStatusFilter } from "@/lib/inbox/conversations";

export const dynamic = "force-dynamic";

const STATUSES: readonly string[] = ["waiting", "attending", "closed"];

/** SPEC-068a: lista de conversas da org da sessão, paginada por cursor (`lastMessageAt DESC`). `status=waiting|attending|closed`, `q` (nome/empresa/telefone), `limit<=50`. Sem efeito colateral. */
export async function GET(req: Request): Promise<Response> {
  const g = await inboxReadGuard();
  if (g instanceof Response) return g;
  const q = new URL(req.url).searchParams;
  const limit = parseLimit(q.get("limit"));
  if (limit === null) return invalidInput("limit inválido.");
  const status = q.get("status");
  if (status !== null && !STATUSES.includes(status)) return invalidInput("status inválido.");
  const search = q.get("q");
  if (search !== null && search.length > 100) return invalidInput("q inválido.");
  const r = await listConversations(g.orgId, new Date(), { status: (status as ConversationStatusFilter | null) ?? undefined, q: search ?? undefined, cursor: q.get("cursor") ?? undefined, limit });
  if (r === "invalid_cursor") return invalidInput("cursor inválido.");
  return ok(r.items, { nextCursor: r.nextCursor });
}
