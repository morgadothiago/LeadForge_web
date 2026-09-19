import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const INBOUND_TEXT_MAX = 200;

/** Texto de resposta para exibição: sem tags HTML/controle, espaços colapsados, truncado em 200. O front deve renderizar SEMPRE como texto. */
export function sanitizeInboundText(text: string | null | undefined): string | null {
  if (!text) return null;
  const clean = text
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return null;
  return clean.length > INBOUND_TEXT_MAX ? `${clean.slice(0, INBOUND_TEXT_MAX - 1)}…` : clean;
}

export interface LastInbound {
  lastInboundAt: Date;
  lastInboundText: string | null;
}

/** Última mensagem inbound por lead em 1 query (DISTINCT ON), sem N+1. Sem inbound = ausente no Map. */
export async function getLastInboundByLead(leadIds: string[]): Promise<Map<string, LastInbound>> {
  const out = new Map<string, LastInbound>();
  if (!leadIds.length) return out;
  const rows = await prisma.$queryRaw<{ leadId: string; content: string | null; at: Date }[]>(Prisma.sql`
    SELECT DISTINCT ON ("leadId") "leadId", content, COALESCE("repliedAt", "createdAt") AS at
    FROM "Touch"
    WHERE direction = 'inbound'::"TouchDirection" AND "leadId" IN (${Prisma.join(leadIds)})
    ORDER BY "leadId", "createdAt" DESC, id DESC`);
  for (const r of rows) out.set(r.leadId, { lastInboundAt: r.at, lastInboundText: sanitizeInboundText(r.content) });
  return out;
}
