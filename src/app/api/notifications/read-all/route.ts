import { prisma } from "@/lib/prisma";
import { fail, invalidInput, ok } from "@/lib/mobile/http";
import { isArea, kindsOfArea, type Area } from "@/lib/notifications/areas";
import { forbiddenOrigin, requireSession, sameOriginOk } from "@/lib/notifications/http";

export const dynamic = "force-dynamic";

/** SPEC-028: marca todas como lidas (sessao); corpo opcional `{ "area": "calendario" | "leads" | "configuracoes" | "aprovacoes" }`. Idempotente. */
export async function POST(req: Request): Promise<Response> {
  const a = await requireSession();
  if (a instanceof Response) return a;
  if (!a.orgId) return fail(403, "forbidden", "Sem permissão.");
  if (!sameOriginOk(req)) return forbiddenOrigin();
  let area: Area | null = null;
  const text = await req.text();
  if (text.trim()) {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return invalidInput("JSON inválido.");
    }
    const v = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).area : undefined;
    if (v !== undefined && v !== null) {
      if (!isArea(v)) return invalidInput("area inválida.");
      area = v;
    }
  }
  const r = await prisma.mobileAlert.updateMany({
    where: { orgId: a.orgId, readAt: null, kind: area ? { in: kindsOfArea(area) } : { not: "baseline" } },
    data: { readAt: new Date() },
  });
  return ok({ updated: r.count });
}
