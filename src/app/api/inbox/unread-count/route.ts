import { ok } from "@/lib/mobile/http";
import { inboxReadGuard } from "@/lib/inbox/http";
import { unreadTotals } from "@/lib/inbox/unread";

export const dynamic = "force-dynamic";

/** SPEC-068a: total de não lidas da org (badge do sidebar). 1 agregação; sem efeito colateral. */
export async function GET(): Promise<Response> {
  const g = await inboxReadGuard();
  if (g instanceof Response) return g;
  return ok(await unreadTotals(g.orgId));
}
