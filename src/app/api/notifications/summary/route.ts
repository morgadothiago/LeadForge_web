import { fail, ok } from "@/lib/mobile/http";
import { sweepThrottled } from "@/lib/mobile/alerts";
import { etagOf, etagMatches, requireSession } from "@/lib/notifications/http";
import { getNotificationSummary } from "@/lib/notifications/summary";

export const dynamic = "force-dynamic";

/** SPEC-028: resumo para o sino/sidebar (polling). Sessao (cookie). ETag/If-None-Match -> 304. Sem PII. */
export async function GET(req: Request): Promise<Response> {
  const a = await requireSession();
  if (a instanceof Response) return a;
  if (!a.orgId) return fail(403, "forbidden", "Sem permissão.");
  await sweepThrottled().catch(() => {}); // cobre "scheduler parado" e lembretes (limitado a 1x/60 s)
  const res = ok(await getNotificationSummary(a.orgId));
  const body = await res.text();
  const etag = etagOf(body);
  const headers = { ETag: etag, "Cache-Control": "private, no-cache", "Content-Type": "application/json; charset=utf-8" };
  if (etagMatches(req.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers });
  return new Response(body, { status: 200, headers });
}
