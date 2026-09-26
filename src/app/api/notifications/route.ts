import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { invalidInput, ok } from "@/lib/mobile/http";
import { alertView, sweepThrottled } from "@/lib/mobile/alerts";
import { areaOfKind, isArea, kindsOfArea } from "@/lib/notifications/areas";
import { decodeCursor, encodeCursor, requireSession } from "@/lib/notifications/http";

export const dynamic = "force-dynamic";

/** SPEC-028: lista (sessao). Cursor createdAt,id; filtros area, kind, unread=true|false; limit 1..50 (padrao 20). */
export async function GET(req: Request): Promise<Response> {
  const a = await requireSession();
  if (a instanceof Response) return a;
  const q = new URL(req.url).searchParams;

  let limit = 20;
  const rawLimit = q.get("limit");
  if (rawLimit !== null) {
    if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1) return invalidInput("limit inválido.");
    limit = Math.min(Number(rawLimit), 50);
  }
  const rawCursor = q.get("cursor");
  const cursor = rawCursor === null ? null : decodeCursor(rawCursor);
  if (rawCursor !== null && !cursor) return invalidInput("cursor inválido.");
  const area = q.get("area");
  if (area !== null && !isArea(area)) return invalidInput("area inválida.");
  const kind = q.get("kind");
  if (kind !== null && !/^[a-z_]{1,40}$/.test(kind)) return invalidInput("kind inválido.");
  const unread = q.get("unread");
  if (unread !== null && unread !== "true" && unread !== "false") return invalidInput("unread inválido.");

  const and: Prisma.MobileAlertWhereInput[] = [{ kind: { not: "baseline" } }];
  if (area) and.push({ kind: { in: kindsOfArea(area) } }); // aprovacoes nao tem alertas: lista vazia
  if (kind) and.push({ kind });
  if (unread === "true") and.push({ readAt: null });
  if (unread === "false") and.push({ readAt: { not: null } });
  if (cursor) and.push({ OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] });

  await sweepThrottled().catch(() => {});
  const rows = await prisma.mobileAlert.findMany({ where: { AND: and }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1 });
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return ok(items.map((r) => ({ ...alertView(r), area: areaOfKind(r.kind) })), { nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null });
}
