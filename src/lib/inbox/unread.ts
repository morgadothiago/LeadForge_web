import { prisma } from "@/lib/prisma";

/** Total de não lidas da org para o badge do sidebar: 1 agregação. `closed` não conta (encerrada = resolvida). */
export async function unreadTotals(orgId: string): Promise<{ unreadMessages: number; unreadConversations: number }> {
  const a = await prisma.waConversation.aggregate({ where: { orgId, status: { not: "closed" }, unreadCount: { gt: 0 } }, _sum: { unreadCount: true }, _count: { _all: true } });
  return { unreadMessages: a._sum.unreadCount ?? 0, unreadConversations: a._count._all };
}
