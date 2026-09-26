import { prisma } from "@/lib/prisma";
import { summarizeByKind } from "./areas";

export interface NotificationSummary {
  unreadTotal: number;
  byArea: { calendario: number; leads: number; configuracoes: number; aprovacoes: number };
}

/** Sem PII: so contagens. unreadTotal = alertas nao lidos (kind desconhecido conta so aqui); aprovacoes = Draft pendentes (fila de aprovacao). */
export async function getNotificationSummary(): Promise<NotificationSummary> {
  const [groups, pendingDrafts] = await Promise.all([
    prisma.mobileAlert.groupBy({ by: ["kind"], where: { readAt: null, kind: { not: "baseline" } }, _count: { _all: true } }),
    prisma.draft.count({ where: { status: "pending" } }),
  ]);
  const s = summarizeByKind(groups.map((g) => ({ kind: g.kind, count: g._count._all })));
  return { unreadTotal: s.unreadTotal, byArea: { ...s.byArea, aprovacoes: pendingDrafts } };
}
